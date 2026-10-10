import os
import requests
from dotenv import load_dotenv

load_dotenv()

FRED_API_KEY = os.getenv("FRED_API_KEY")


def fetch_macro_indicators() -> dict:
    """Fetches key yield curve rates and inflation indicators from FRED API."""
    if not FRED_API_KEY:
        raise ValueError("FRED_API_KEY is missing. Define it in backend/.env to enable live feeds.")

    series_ids = {
        "10Y_Yield": "DGS10",
        "2Y_Yield": "DGS2",
        "CPI_Inflation": "CPIAUCSL",
        "Fed_Funds_Rate": "FEDFUNDS",
    }

    macro_data = {}
    for name, series_id in series_ids.items():
        url = (
            "https://api.stlouisfed.org/fred/series/observations"
            f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=5"
        )
        res = requests.get(url, timeout=10)
        if res.status_code != 200:
            raise ConnectionError(
                f"FRED API Request failed for {name} ({series_id}). Status: {res.status_code}"
            )

        data = res.json()
        latest_obs = None
        for obs in data.get("observations", []):
            if obs.get("value") not in (None, "."):
                latest_obs = obs["value"]
                break
        macro_data[name] = float(latest_obs) if latest_obs is not None else None

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
