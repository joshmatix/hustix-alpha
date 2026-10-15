from fastapi import APIRouter, HTTPException, Response, UploadFile, File, status, Header
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from uuid import UUID, uuid4
import datetime
import io
import pandas as pd

from database import SUPABASE_UNREACHABLE, SUPABASE_URL, authorize_client, client_for_token
from engine.equity_prices import fetch_closing_prices, fetch_equity_price, is_equity_class, yahoo_symbol

router = APIRouter(prefix="/api/portfolios", tags=["Portfolios"])


class PortfolioListResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    portfolio_value: float = 0
    asset_allocation: Dict[str, float] = Field(
        default_factory=lambda: {"equities": 60, "bonds": 25, "realAssets": 10, "cash": 5}
    )
    target_risk_profile: Optional[str] = "Balanced"
    created_at: Optional[datetime.datetime] = None


class PortfolioCreateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    account_alias: Optional[str] = None
    target_risk_profile: Optional[str] = "Balanced"
    portfolio_value: Optional[float] = 0
    asset_allocation: Optional[Dict[str, float]] = None
    firm_id: Optional[UUID] = None


class PortfolioResponse(BaseModel):
    portfolio_id: UUID
    account_alias: str
    target_risk_profile: Optional[str] = "Balanced"
    created_at: datetime.datetime


class HoldingCreate(BaseModel):
    portfolio_id: UUID
    ticker: str
    asset_name: Optional[str] = None
    asset_class: str
    quantity: float = Field(gt=0)
    current_price: float = Field(gt=0)
    duration_years: Optional[float] = 0.0
    beta: Optional[float] = 1.0


class HoldingResponse(HoldingCreate):
    holding_id: UUID
    updated_at: datetime.datetime


class HoldingListItem(BaseModel):
    holding_id: UUID
    ticker: str
    asset_name: Optional[str] = None
    asset_class: str
    quantity: float
    current_price: float
    market_value: float
    duration_years: float = 0
    beta: float = 1


DEFAULT_ALLOCATION = {"equities": 60, "bonds": 25, "realAssets": 10, "cash": 5}
PORTFOLIO_COLUMNS = (
    "id,name,description,account_alias,target_risk_profile,"
    "portfolio_value,asset_allocation,created_at,firm_id,created_by"
)


def _require_user_id(authorization: Optional[str]):
    if SUPABASE_UNREACHABLE:
        raise HTTPException(status_code=503, detail=SUPABASE_UNREACHABLE)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        db = client_for_token(token)
        result = db.auth.get_user(token)
        db = authorize_client(db, token)
        user = getattr(result, "user", None)
        user_id = getattr(user, "id", None) if user else None
        if not user_id:
            raise ValueError("No user on token")
        return str(user_id), db
    except HTTPException:
        raise
    except Exception as exc:
        message = str(exc)
        if "Connection refused" in message or "Errno 111" in message:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Cannot reach Supabase at {SUPABASE_URL}. "
                    "On Vercel, SUPABASE_URL must be the hosted project URL, not 127.0.0.1."
                ),
            ) from exc
        raise HTTPException(status_code=401, detail=f"Invalid session token: {message}") from exc


def _worth(value: float) -> str:
    if value >= 1_000_000:
        scaled = value / 1_000_000
        text = f"{scaled:.1f}".rstrip("0").rstrip(".")
        return f"${text}M"
    if value >= 1_000:
        scaled = value / 1_000
        text = f"{scaled:.1f}".rstrip("0").rstrip(".")
        return f"${text}K"
    return f"${value:,.0f}"


def _parsed_portfolio_message(ticker_count: int, value: float) -> str:
    return f"We successfully parsed your {ticker_count}-ticker portfolio worth {_worth(value)}."


def _plan_code(db, firm_id: str | None) -> str:
    if not firm_id:
        return "free"
    result = (
        db.table("subscriptions")
        .select("plan_code")
        .eq("firm_id", firm_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        return "free"
    return result.data[0].get("plan_code") or "free"


def _plan_cap(db, firm_id: str | None) -> dict:
    result = db.rpc("plan_cap", {"target_code": _plan_code(db, firm_id)}).execute()
    data = result.data or {}
    return data if isinstance(data, dict) else {}


def _limit_block(db, firm_id: str | None, kind: str, count: int) -> dict | None:
    caps = _plan_cap(db, firm_id)
    raw_limit = caps.get("portfolio_limit") if kind == "portfolios" else caps.get("ticker_limit")
    if raw_limit is None or count <= int(raw_limit):
        return None
    message = db.rpc(
        "portfolio_limit_message" if kind == "portfolios" else "ticker_limit_message",
        {"target_code": caps.get("code") or "free"},
    ).execute()
    return {
        "message": message.data,
        "upgrade_code": caps.get("upgrade_code"),
        "upgrade_name": caps.get("upgrade_name"),
    }


def _portfolio_firm_id(db, portfolio_id: str) -> str | None:
    portfolio = (
        db.table("portfolios")
        .select("firm_id")
        .eq("id", portfolio_id)
        .limit(1)
        .execute()
    )
    if not portfolio.data:
        return None
    firm_id = portfolio.data[0].get("firm_id")
    return str(firm_id) if firm_id else None


def _portfolio_symbols(db, portfolio_id: str) -> set[str]:
    rows = (
        db.table("portfolio_holdings")
        .select("ticker")
        .eq("portfolio_id", portfolio_id)
        .execute()
    )
    return {yahoo_symbol(row["ticker"]) for row in (rows.data or []) if row.get("ticker")}


def _firm_ids_for_user(user_id: str, db) -> List[str]:
    membership = (
        db.table("firm_members")
        .select("firm_id")
        .eq("user_id", user_id)
        .execute()
    )
    firm_ids = [str(row["firm_id"]) for row in (membership.data or [])]
    if firm_ids:
        return firm_ids

    created = db.rpc("ensure_shadow_firm").execute()
    firm_id = created.data
    if isinstance(firm_id, list):
        firm_id = firm_id[0] if firm_id else None
    if not firm_id:
        raise HTTPException(status_code=409, detail="This advisor is not attached to a firm.")
    return [str(firm_id)]


def _require_firms(authorization: Optional[str]):
    user_id, db = _require_user_id(authorization)
    return user_id, _firm_ids_for_user(user_id, db), db


def _assigned_portfolio_ids(user_id: str, db) -> List[str]:
    rows = (
        db.table("portfolio_advisors")
        .select("portfolio_id")
        .eq("user_id", user_id)
        .execute()
    )
    return [str(row["portfolio_id"]) for row in (rows.data or [])]


def _require_assignments(authorization: Optional[str]):
    user_id, _, db = _require_firms(authorization)
    return user_id, _assigned_portfolio_ids(user_id, db), db


def _firm_for_new_portfolio(firm_ids: List[str], requested: Optional[UUID]) -> str:
    if requested is not None:
        chosen = str(requested)
        if chosen not in firm_ids:
            raise HTTPException(status_code=404, detail="Firm not found.")
        return chosen
    if len(firm_ids) == 1:
        return firm_ids[0]
    raise HTTPException(
        status_code=422,
        detail="firm_id is required when the advisor belongs to more than one firm.",
    )


def _normalize_allocation(raw: Any) -> Dict[str, float]:
    if not isinstance(raw, dict):
        return dict(DEFAULT_ALLOCATION)
    return {
        "equities": float(raw.get("equities", raw.get("Equities", DEFAULT_ALLOCATION["equities"]))),
        "bonds": float(raw.get("bonds", raw.get("Bonds", DEFAULT_ALLOCATION["bonds"]))),
        "realAssets": float(raw.get("realAssets", raw.get("Real_Assets", DEFAULT_ALLOCATION["realAssets"]))),
        "cash": float(raw.get("cash", raw.get("Cash", DEFAULT_ALLOCATION["cash"]))),
    }


def _to_list_item(item: dict) -> dict:
    name = item.get("name") or item.get("account_alias") or item.get("client_name") or "Untitled"
    return {
        "id": item.get("id") or item.get("portfolio_id"),
        "name": name,
        "description": item.get("description") or item.get("target_risk_profile") or "",
        "portfolio_value": float(item.get("portfolio_value") or item.get("total_value") or 0),
        "asset_allocation": _normalize_allocation(item.get("asset_allocation") or item.get("weights")),
        "target_risk_profile": item.get("target_risk_profile") or "Balanced",
        "created_at": item.get("created_at"),
    }


@router.get("", response_model=List[PortfolioListResponse])
@router.get("/", response_model=List[PortfolioListResponse], include_in_schema=False)
async def get_portfolios(authorization: Optional[str] = Header(default=None)):
    _, assigned, db = _require_assignments(authorization)
    if not assigned:
        return []
    try:
        response = (
            db.table("portfolios")
            .select(PORTFOLIO_COLUMNS)
            .in_("id", assigned)
            .order("created_at", desc=True)
            .execute()
        )
        return [_to_list_item(item) for item in (response.data or [])]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch portfolios: {str(e)}")


@router.get("/{portfolio_id}", response_model=PortfolioListResponse)
async def get_portfolio(portfolio_id: UUID, authorization: Optional[str] = Header(default=None)):
    _, assigned, db = _require_assignments(authorization)
    if str(portfolio_id) not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    try:
        response = (
            db.table("portfolios")
            .select(PORTFOLIO_COLUMNS)
            .eq("id", str(portfolio_id))
            .limit(1)
            .execute()
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Portfolio not found.")
        return _to_list_item(response.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch portfolio: {str(e)}")


@router.get("/{portfolio_id}/holdings", response_model=List[HoldingListItem])
async def get_holdings(portfolio_id: UUID, authorization: Optional[str] = Header(default=None)):
    _, assigned, db = _require_assignments(authorization)
    if str(portfolio_id) not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    try:
        response = (
            db.table("portfolio_holdings")
            .select("*")
            .eq("portfolio_id", str(portfolio_id))
            .order("ticker")
            .execute()
        )
        items = []
        for row in response.data or []:
            quantity = float(row["quantity"])
            price = float(row["current_price"])
            items.append({
                "holding_id": row["holding_id"],
                "ticker": row["ticker"],
                "asset_name": row.get("asset_name"),
                "asset_class": row["asset_class"],
                "quantity": quantity,
                "current_price": price,
                "market_value": quantity * price,
                "duration_years": float(row.get("duration_years") or 0),
                "beta": float(row.get("beta") or 1),
            })
        return items
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch holdings: {str(e)}")


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_portfolio(portfolio_id: UUID, authorization: Optional[str] = Header(default=None)):
    _, assigned, db = _require_assignments(authorization)
    portfolio_key = str(portfolio_id)
    if portfolio_key not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    try:
        db.table("portfolio_holdings").delete().eq("portfolio_id", portfolio_key).execute()
        deleted = (
            db.table("portfolios")
            .delete()
            .eq("id", portfolio_key)
            .execute()
        )
        if not deleted.data:
            raise HTTPException(status_code=404, detail="Portfolio not found.")
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete portfolio: {str(e)}")


@router.post("/create", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
async def create_portfolio(
    portfolio_data: PortfolioCreateRequest,
    authorization: Optional[str] = Header(default=None),
):
    user_id, firm_ids, db = _require_firms(authorization)
    name = (portfolio_data.name or portfolio_data.account_alias or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Portfolio name is required.")
    firm_id = _firm_for_new_portfolio(firm_ids, portfolio_data.firm_id)
    book_count = len(_assigned_portfolio_ids(user_id, db))
    blocked = _limit_block(db, firm_id, "portfolios", book_count + 1)
    if blocked:
        raise HTTPException(status_code=422, detail=blocked)

    payload = {
        "firm_id": firm_id,
        "created_by": user_id,
        "name": name,
        "description": portfolio_data.description or "",
        "account_alias": portfolio_data.account_alias or name,
        "target_risk_profile": portfolio_data.target_risk_profile or "Balanced",
        "portfolio_value": 0 if portfolio_data.portfolio_value is None else portfolio_data.portfolio_value,
        "asset_allocation": portfolio_data.asset_allocation or DEFAULT_ALLOCATION,
    }

    try:
        response = db.table("portfolios").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="Database rejected portfolio insertion.")
        created = response.data[0]
        portfolio_id = created.get("id") or created.get("portfolio_id")
        assignment = db.table("portfolio_advisors").insert({
            "portfolio_id": str(portfolio_id),
            "user_id": user_id,
        }).execute()
        if not assignment.data:
            db.table("portfolios").delete().eq("id", str(portfolio_id)).execute()
            raise HTTPException(status_code=400, detail="Database rejected the advisor assignment.")
        return PortfolioResponse(
            portfolio_id=portfolio_id,
            account_alias=created.get("account_alias") or created.get("name") or name,
            target_risk_profile=created.get("target_risk_profile") or "Balanced",
            created_at=created["created_at"],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create portfolio in database: {str(e)}")


@router.post("/add-ticker", response_model=HoldingResponse, status_code=status.HTTP_201_CREATED)
async def add_ticker(holding: HoldingCreate, authorization: Optional[str] = Header(default=None)):
    _, assigned, db = _require_assignments(authorization)
    if str(holding.portfolio_id) not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    try:
        ticker = yahoo_symbol(holding.ticker)
        portfolio_key = str(holding.portfolio_id)
        symbols = _portfolio_symbols(db, portfolio_key)
        if ticker not in symbols:
            blocked = _limit_block(db, _portfolio_firm_id(db, portfolio_key), "tickers", len(symbols) + 1)
            if blocked:
                raise HTTPException(status_code=422, detail=blocked)
        price = holding.current_price
        if is_equity_class(holding.asset_class):
            live_price = fetch_equity_price(ticker)
            if live_price is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Yahoo Finance has no price for {ticker}.",
                )
            price = live_price
        payload = {
            "holding_id": str(uuid4()),
            "portfolio_id": str(holding.portfolio_id),
            "ticker": ticker,
            "asset_name": holding.asset_name or ticker,
            "asset_class": holding.asset_class,
            "quantity": holding.quantity,
            "current_price": price,
            "duration_years": holding.duration_years or 0.0,
            "beta": holding.beta or 1.0,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        response = db.table("portfolio_holdings").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="Database failed to persist the holding record.")
        created = response.data[0]
        return HoldingResponse(
            holding_id=created["holding_id"],
            portfolio_id=created["portfolio_id"],
            ticker=created["ticker"],
            asset_name=created["asset_name"],
            asset_class=created["asset_class"],
            quantity=created["quantity"],
            current_price=created["current_price"],
            duration_years=created["duration_years"],
            beta=created["beta"],
            updated_at=created["updated_at"],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add holding in database: {str(e)}")


@router.post("/{portfolio_id}/upload-csv", status_code=status.HTTP_201_CREATED)
async def upload_csv(
    portfolio_id: UUID,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(default=None),
):
    _, assigned, db = _require_assignments(authorization)
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV format (.csv)")
    if str(portfolio_id) not in assigned:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    try:
        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents))
        df.columns = [c.strip().lower() for c in df.columns]

        required_cols = {"ticker", "asset_class", "quantity", "current_price"}
        if not required_cols.issubset(set(df.columns)):
            raise HTTPException(
                status_code=422,
                detail=f"CSV missing required columns: {required_cols - set(df.columns)}",
            )

        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        records_to_insert = []
        total_value = 0.0
        class_totals = {"equities": 0.0, "bonds": 0.0, "realAssets": 0.0, "cash": 0.0}
        class_map = {
            "equities": "equities",
            "equity": "equities",
            "stocks": "equities",
            "bonds": "bonds",
            "fixed income": "bonds",
            "real_assets": "realAssets",
            "real assets": "realAssets",
            "commodities": "realAssets",
            "cash": "cash",
        }

        parsed_rows = []
        for _, row in df.iterrows():
            asset_class = str(row["asset_class"]).strip()
            ticker = yahoo_symbol(row["ticker"])
            parsed_rows.append({
                "ticker": ticker,
                "asset_name": str(row["asset_name"] if "asset_name" in df.columns else row["ticker"]).strip(),
                "asset_class": asset_class,
                "quantity": float(row["quantity"]),
                "current_price": float(row["current_price"]),
                "duration_years": float(row["duration_years"]) if "duration_years" in df.columns else 0.0,
                "beta": float(row["beta"]) if "beta" in df.columns else 1.0,
                "equity": is_equity_class(asset_class),
            })

        equity_prices = fetch_closing_prices(
            [row["ticker"] for row in parsed_rows if row["equity"]]
        )
        missing = sorted({row["ticker"] for row in parsed_rows if row["equity"] and row["ticker"] not in equity_prices})
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Yahoo Finance has no price for: {', '.join(missing)}",
            )

        for row in parsed_rows:
            price = equity_prices[row["ticker"]] if row["equity"] else row["current_price"]
            market_value = row["quantity"] * price
            total_value += market_value
            mapped = class_map.get(row["asset_class"].lower(), "equities")
            class_totals[mapped] += market_value
            records_to_insert.append({
                "holding_id": str(uuid4()),
                "portfolio_id": str(portfolio_id),
                "ticker": row["ticker"],
                "asset_name": row["asset_name"],
                "asset_class": row["asset_class"],
                "quantity": row["quantity"],
                "current_price": price,
                "duration_years": row["duration_years"],
                "beta": row["beta"],
                "updated_at": now_iso,
            })

        ticker_count = len({row["ticker"] for row in parsed_rows if row["ticker"]})
        portfolio_key = str(portfolio_id)
        combined = _portfolio_symbols(db, portfolio_key) | {row["ticker"] for row in parsed_rows}
        blocked = _limit_block(
            db,
            _portfolio_firm_id(db, portfolio_key),
            "tickers",
            max(ticker_count, len(combined)),
        )
        if blocked:
            return {
                "status": "upgrade_required",
                "portfolio_id": portfolio_key,
                "ticker_count": ticker_count,
                "portfolio_value": total_value,
                "message": _parsed_portfolio_message(ticker_count, total_value),
                "detail": blocked["message"],
                "upgrade_code": blocked["upgrade_code"],
                "upgrade_name": blocked["upgrade_name"],
            }

        response = db.table("portfolio_holdings").insert(records_to_insert).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="Database rejected bulk CSV records insert.")

        allocation = DEFAULT_ALLOCATION
        if total_value > 0:
            allocation = {
                key: round((value / total_value) * 100, 1)
                for key, value in class_totals.items()
            }
            db.table("portfolios").update({
                "portfolio_value": total_value,
                "asset_allocation": allocation,
            }).eq("id", str(portfolio_id)).execute()

        return {
            "status": "success",
            "portfolio_id": str(portfolio_id),
            "records_imported": len(response.data),
            "portfolio_value": total_value,
            "asset_allocation": allocation,
            "equity_prices": equity_prices,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CSV upload failed: {str(e)}")
