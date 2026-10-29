from fastapi import APIRouter

router = APIRouter(prefix="/api/macro", tags=["Macro"])


@router.get("/indicators")
def get_macro_indicators():
    try:
        from engine.macro_feeds import fetch_macro_indicators

        data = fetch_macro_indicators()
        return {"status": "live", "indicators": data}
    except Exception as exc:
        return {
            "status": "fallback",
            "indicators": {
                "10Y_Yield": None,
                "10Y_Yield_change": None,
                "Fed_Funds_Rate": None,
                "Fed_Funds_Rate_change": None,
                "Bitcoin": None,
                "Bitcoin_change_pct": None,
                "Dollar_Index": None,
                "Dollar_Index_change_pct": None,
            },
            "detail": str(exc),
        }
