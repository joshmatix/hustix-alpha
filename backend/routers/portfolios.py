from fastapi import APIRouter, HTTPException, UploadFile, File, status, Header
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from uuid import UUID, uuid4
import datetime
import io
import pandas as pd

from database import supabase
from engine.equity_prices import fetch_equity_price, fetch_equity_prices, is_equity_class, yahoo_symbol

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


def _require_user_id(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        result = supabase.auth.get_user(token)
        user = getattr(result, "user", None)
        user_id = getattr(user, "id", None) if user else None
        if not user_id:
            raise ValueError("No user on token")
        return str(user_id)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid session token: {exc}") from exc


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
    user_id = _require_user_id(authorization)
    try:
        response = (
            supabase.table("portfolios")
            .select("*")
            .eq("user_id", user_id)
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
    user_id = _require_user_id(authorization)
    try:
        response = (
            supabase.table("portfolios")
            .select("*")
            .eq("id", str(portfolio_id))
            .eq("user_id", user_id)
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
    user_id = _require_user_id(authorization)
    owned = (
        supabase.table("portfolios")
        .select("id")
        .eq("id", str(portfolio_id))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not owned.data:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    try:
        response = (
            supabase.table("portfolio_holdings")
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


@router.post("/create", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
async def create_portfolio(
    portfolio_data: PortfolioCreateRequest,
    authorization: Optional[str] = Header(default=None),
):
    user_id = _require_user_id(authorization)
    name = (portfolio_data.name or portfolio_data.account_alias or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Portfolio name is required.")

    payload = {
        "user_id": user_id,
        "name": name,
        "description": portfolio_data.description or "",
        "account_alias": portfolio_data.account_alias or name,
        "target_risk_profile": portfolio_data.target_risk_profile or "Balanced",
        "portfolio_value": 0 if portfolio_data.portfolio_value is None else portfolio_data.portfolio_value,
        "asset_allocation": portfolio_data.asset_allocation or DEFAULT_ALLOCATION,
    }

    try:
        response = supabase.table("portfolios").insert(payload).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="Database rejected portfolio insertion.")
        created = response.data[0]
        return PortfolioResponse(
            portfolio_id=created.get("id") or created.get("portfolio_id"),
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
    _require_user_id(authorization)
    try:
        ticker = yahoo_symbol(holding.ticker)
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
        response = supabase.table("portfolio_holdings").insert(payload).execute()
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
    user_id = _require_user_id(authorization)
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV format (.csv)")

    owned = (
        supabase.table("portfolios")
        .select("id")
        .eq("id", str(portfolio_id))
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not owned.data:
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

        equity_prices = fetch_equity_prices(
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

        response = supabase.table("portfolio_holdings").insert(records_to_insert).execute()
        if not response.data:
            raise HTTPException(status_code=400, detail="Database rejected bulk CSV records insert.")

        allocation = DEFAULT_ALLOCATION
        if total_value > 0:
            allocation = {
                key: round((value / total_value) * 100, 1)
                for key, value in class_totals.items()
            }
            supabase.table("portfolios").update({
                "portfolio_value": total_value,
                "asset_allocation": allocation,
            }).eq("id", str(portfolio_id)).eq("user_id", user_id).execute()

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
