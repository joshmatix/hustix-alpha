from fastapi import APIRouter

router = APIRouter(prefix="/api/macro", tags=["Macro"])

_EMPTY = {
    "10Y_Yield": None,
    "10Y_Yield_change": None,
    "Fed_Funds_Rate": None,
    "Fed_Funds_Rate_change": None,
    "Bitcoin": None,
    "Bitcoin_change_pct": None,
    "Dollar_Index": None,
    "Dollar_Index_change_pct": None,
}


@router.get("/indicators")
def get_macro_indicators():
    try:
        from engine.macro_feeds import fetch_macro_indicators

        data = fetch_macro_indicators()
        has_live = any(
            data.get(key) is not None
            for key in ("10Y_Yield", "Fed_Funds_Rate", "Bitcoin", "Dollar_Index")
        )
        return {
            "status": "live" if has_live else "fallback",
            "indicators": data,
        }
    except Exception as exc:
        return {
            "status": "fallback",
            "indicators": dict(_EMPTY),
            "detail": str(exc),
        }
