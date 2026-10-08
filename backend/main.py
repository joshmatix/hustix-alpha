# my-macro-app/backend/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import portfolios  # Import the portfolio router module

app = FastAPI(
    title="Macro & Risk Stress-Testing API",
    description="Quantitative engine & multi-tenant portfolio middleware for financial advisors",
    version="1.0.0"
)

# ------------------------------------------------------------------------------
# CORS Middleware Configuration
# ------------------------------------------------------------------------------
# Ensures preflight OPTIONS requests return 200 OK and allow cross-origin
# communication between Next.js (frontend) and FastAPI (backend).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # In production, replace with exact frontend domain, e.g., ["http://localhost:3000"]
    allow_credentials=True,
    allow_methods=["*"],            # Allows GET, POST, OPTIONS, PUT, DELETE, etc.
    allow_headers=["*"],            # Allows Content-Type, Authorization, etc.
)

# ------------------------------------------------------------------------------
# Include Modular Routers
# ------------------------------------------------------------------------------
app.include_router(portfolios.router)

# ------------------------------------------------------------------------------
# Root & Health Check Endpoints
# ------------------------------------------------------------------------------
@app.get("/", tags=["Health"])
async def root():
    return {
        "status": "online",
        "service": "Macro Risk Engine Backend",
        "docs_url": "/docs"
    }

@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}