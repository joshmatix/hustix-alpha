import os
import requests
from dotenv import load_dotenv

load_dotenv()

FRED_API_KEY = os.getenv("FRED_API_KEY")


def _latest_pair(observations: list) -> tuple[float | None, float | None]:
    values: list[float] = []
    for obs in observations:
        raw = obs.get("value")
        if raw in (None, "."):
            continue
        values.append(float(raw))
        if len(values) == 2:
            break
    latest = values[0] if values else None
    prior = values[1] if len(values) == 2 else None
    return latest, prior


def _dollar_index() -> tuple[float | None, float | None]:
    """ICE US Dollar Index and its percent move from the prior close."""
    from engine.market_data import fetch_dollar_index

    return fetch_dollar_index()


def fetch_macro_indicators() -> dict:
    """Fetches yield, policy-rate, inflation, Bitcoin, and the dollar index, plus the latest move."""
    if not FRED_API_KEY:
        raise ValueError("FRED_API_KEY is missing. Define it in backend/.env to enable live feeds.")

    # Fed funds uses the daily effective rate so the header change is a day-over-day move.
    # Bitcoin is the Coinbase daily close. Rate changes are percentage points.
    # Bitcoin_change_pct and Dollar_Index_change_pct are percent moves from the prior close.
    series_ids = {
        "10Y_Yield": "DGS10",
        "2Y_Yield": "DGS2",
        "CPI_Inflation": "CPIAUCSL",
        "Fed_Funds_Rate": "DFF",
        "Bitcoin": "CBBTCUSD",
    }

    macro_data = {}
    for name, series_id in series_ids.items():
        url = (
            "https://api.stlouisfed.org/fred/series/observations"
            f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=10"
        )
        res = requests.get(url, timeout=10)
        if res.status_code != 200:
            raise ConnectionError(
                f"FRED API Request failed for {name} ({series_id}). Status: {res.status_code}"
            )

        latest, prior = _latest_pair(res.json().get("observations", []))
        macro_data[name] = latest
        if latest is None or prior is None:
            change = None
        elif name == "Bitcoin" and prior != 0:
            change = (latest - prior) / prior * 100
        else:
            change = latest - prior
        if name == "Bitcoin":
            macro_data["Bitcoin_change_pct"] = change
        elif name in ("10Y_Yield", "Fed_Funds_Rate"):
            macro_data[f"{name}_change"] = change

    try:
        dollar_level, dollar_change = _dollar_index()
    except Exception:
        dollar_level, dollar_change = None, None
    macro_data["Dollar_Index"] = dollar_level
    macro_data["Dollar_Index_change_pct"] = dollar_change

    return macro_data


if __name__ == "__main__":
    print("Testing FRED API Connection...")
    try:
        data = fetch_macro_indicators()
        print("\n Success! Live Macro Indicators Fetched:")
        for metric, val in data.items():
            print(f"  - {metric}: {val}")
    except Exception as e:
        print(f"\n Test Failed: {e}")
