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
                "10Y_Yield": 4.22,
                "10Y_Yield_change": 0.02,
                "Fed_Funds_Rate": 5.25,
                "Fed_Funds_Rate_change": -0.01,
                "Bitcoin": 67420,
                "Bitcoin_change_pct": -0.05,
                "Dollar_Index": 104.20,
                "Dollar_Index_change_pct": 0.12,
            },
            "detail": str(exc),
        }
