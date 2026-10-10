"""Compatibility entrypoint. Run the unified API with:

    uvicorn main:app --reload --port 8000
"""

from main import app  # noqa: F401
