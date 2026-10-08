# my-macro-app/backend/routers/portfolios.py

from fastapi import APIRouter, HTTPException, UploadFile, File, status
from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID, uuid4
import datetime
import io
import pandas as pd
from database import supabase

# Add this new Schema for the GET response to match what the Frontend expects 
# OR we update the frontend. Let's update the backend to be explicit.
class PortfolioListResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = "No description provided."


router = APIRouter(
    prefix="/api/portfolios",
    tags=["Portfolios"]
)

# ------------------------------------------------------------------------------
# Pydantic Schemas (Pydantic v2 Compliant)
# ------------------------------------------------------------------------------

# 1. Portfolio Creation Schemas
class PortfolioCreateRequest(BaseModel):
    account_alias: str = Field(min_length=1, max_length=100, json_schema_extra={"example": "Account_89211"})
    target_risk_profile: Optional[str] = Field(default="Balanced", json_schema_extra={"example": "Growth"})

class PortfolioResponse(BaseModel):
    portfolio_id: UUID
    account_alias: str = Field(min_length=1, max_length=100, json_schema_extra={"example": "Account_89211"})
    target_risk_profile: Optional[str] = Field(default="Balanced", json_schema_extra={"example": "Growth"})
    created_at: datetime.datetime


# 2. Holdings & Ticker Schemas
class HoldingCreate(BaseModel):
    portfolio_id: UUID
    ticker: str = Field(json_schema_extra={"example": "AAPL"})
    asset_name: Optional[str] = Field(default="Apple Inc.")
    asset_class: str = Field(json_schema_extra={"example": "Equities"})
    quantity: float = Field(gt=0)
    current_price: float = Field(gt=0)
    duration_years: Optional[float] = 0.0
    beta: Optional[float] = 1.0

class HoldingResponse(HoldingCreate):
    holding_id: UUID
    updated_at: datetime.datetime

# 0. GET ALL PORTFOLIOS (The missing piece!)
@router.get("/", response_model=List[PortfolioListResponse])
async def get_portfolios():
    try:
        response = supabase.table("portfolios").select("*").execute()
        if not response.data:
            return []
        
        # We transform the Supabase data to match the Frontend's expected keys:
        # 'portfolio_id' -> 'id'
        # 'account_alias' -> 'name'
        transformed_data = []
        for item in response.data:
            transformed_data.append({
                "id": item["portfolio_id"],
                "name": item["account_alias"],
                "description": item.get("target_risk_profile", "") # Using risk profile as description for now
            })
        return transformed_data
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to fetch portfolios: {str(e)}"
        )
    
# ------------------------------------------------------------------------------
# Router Endpoints
# ------------------------------------------------------------------------------

# 1. CREATE NEW PORTFOLIO
@router.post(
    "/create", 
    response_model=PortfolioResponse, 
    status_code=status.HTTP_201_CREATED
)
async def create_portfolio(portfolio_data: PortfolioCreateRequest):
    try:
        payload = {
            "account_alias": portfolio_data.account_alias,
            "target_risk_profile": portfolio_data.target_risk_profile or "Balanced",
        }

        # Execute Supabase DB Insert
        response = supabase.table("portfolios").insert(payload).execute()

        # Check for errors from Supabase
        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Database rejected portfolio insertion."
            )

        created_record = response.data[0]

        return PortfolioResponse(
            portfolio_id=created_record["portfolio_id"],
            account_alias=created_record["account_alias"],
            target_risk_profile=created_record["target_risk_profile"],
            created_at=created_record["created_at"]
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create portfolio in database: {str(e)}"
        )


# 2. ADD SINGLE TICKER HOLDING
@router.post(
    "/add-ticker", 
    response_model=HoldingResponse, 
    status_code=status.HTTP_201_CREATED
)
async def add_ticker(holding: HoldingCreate):
    try:
        # Prepare payload for Postgres
        payload = {
            "holding_id": str(uuid4()),
            "portfolio_id": str(holding.portfolio_id),
            "ticker": holding.ticker.upper(),
            "asset_name": holding.asset_name or holding.ticker.upper(),
            "asset_class": holding.asset_class,
            "quantity": holding.quantity,
            "current_price": holding.current_price,
            "duration_years": holding.duration_years or 0.0,
            "beta": holding.beta or 1.0,
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        # Execute Supabase Insert
        response = supabase.table("portfolio_holdings").insert(payload).execute()

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Database failed to persist the holding record."
            )

        created_record = response.data[0]

        return HoldingResponse(
            holding_id=created_record["holding_id"],
            portfolio_id=created_record["portfolio_id"],
            ticker=created_record["ticker"],
            asset_name=created_record["asset_name"],
            asset_class=created_record["asset_class"],
            quantity=created_record["quantity"],
            current_price=created_record["current_price"],
            duration_years=created_record["duration_years"],
            beta=created_record["beta"],
            updated_at=created_record["updated_at"]
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add holding in database: {str(e)}"
        )


# 3. BULK UPLOAD HOLDINGS VIA CSV
@router.post(
    "/{portfolio_id}/upload-csv", 
    status_code=status.HTTP_201_CREATED
)
async def upload_csv(portfolio_id: UUID, file: UploadFile = File(...)):
    # Validate extension
    if not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="File must be a CSV format (.csv)"
        )

    try:
        # Read uploaded bytes into Pandas DataFrame
        contents = await file.read()
        df = pd.read_csv(io.BytesIO(contents))
        df.columns = [c.strip().lower() for c in df.columns]

        # Verify mandatory headers
        required_cols = {"ticker", "asset_class", "quantity", "current_price"}
        if not required_cols.issubset(set(df.columns)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"CSV missing required columns: {required_cols - set(df.columns)}"
            )

        # Build array of records for batch insertion
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        records_to_insert = []

        for _, row in df.iterrows():
            records_to_insert.append({
                "holding_id": str(uuid4()),
                "portfolio_id": str(portfolio_id),
                "ticker": str(row["ticker"]).strip().upper(),
                "asset_name": str(row.get("asset_name", row["ticker"])).strip(),
                "asset_class": str(row["asset_class"]).strip(),
                "quantity": float(row["quantity"]),
                "current_price": float(row["current_price"]),
                "duration_years": float(row.get("duration_years", 0.0)),
                "beta": float(row.get("beta", 1.0)),
                "updated_at": now_iso
            })

        # Batch Insert into Supabase table in a single request
        response = supabase.table("portfolio_holdings").insert(records_to_insert).execute()

        if not response.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Database rejected bulk CSV records insert."
            )

        return {
            "status": "success",
            "portfolio_id": str(portfolio_id),
            "records_imported": len(response.data),
            "holdings": response.data
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"CSV upload failed: {str(e)}"
        )