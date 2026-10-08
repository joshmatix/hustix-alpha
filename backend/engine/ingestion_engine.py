# ingestion_engine.py
from pydantic import BaseModel
from typing import List, Dict

class RawHolding(BaseModel):
    symbol: str
    marketValue: float

class NormalizedPortfolio(BaseModel):
    total_value: float
    weights: Dict[str, float]

def normalize_portfolio(holdings: List[RawHolding]) -> NormalizedPortfolio:
    total_val = sum(h.marketValue for h in holdings)
    
    # Mapping table for asset classification
    ASSET_MAP = {
        "SPY": "Equities", "QQQ": "Equities", "AAPL": "Equities",
        "AGG": "Bonds", "TLT": "Bonds", "BND": "Bonds",
        "GLD": "Real_Assets", "VNQ": "Real_Assets", "DBC": "Real_Assets",
        "BIL": "Cash", "USD": "Cash"
    }

    categorized_totals = {"Equities": 0.0, "Bonds": 0.0, "Real_Assets": 0.0, "Cash": 0.0}

    for h in holdings:
        category = ASSET_MAP.get(h.symbol.upper(), "Equities") # Default to Equities if unknown
        categorized_totals[category] += h.marketValue

    weights = {cat: val / total_val for cat, val in categorized_totals.items()}
    
    return NormalizedPortfolio(total_value=total_val, weights=weights)