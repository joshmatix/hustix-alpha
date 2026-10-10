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
                "Fed_Funds_Rate": 5.25,
            },
            "detail": str(exc),
        }
