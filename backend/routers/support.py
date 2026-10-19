"""Support address for a signed-in advisor.

Public pages do not include the address, so it is not sitting in the HTML
for scrapers.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Header

from routers.portfolios import _require_user_id

router = APIRouter(prefix="/api/support", tags=["Support"])


@router.get("/contact")
def contact(authorization: Optional[str] = Header(default=None)):
    _require_user_id(authorization)
    return {"email": os.getenv("SUPPORT_EMAIL", "support@hustix.com")}
