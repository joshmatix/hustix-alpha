from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import admin, portfolios, simulate, macro, stripe_webhook, support

app = FastAPI(
    title="Macro & Risk Stress-Testing API",
    description="Quantitative engine & multi-tenant portfolio middleware for financial advisors",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # The app is opened at localhost:3000 while the API is 127.0.0.1:8000.
    # Chrome treats that as a private-network request and blocks it unless
    # the preflight is explicitly allowed.
    allow_private_network=True,
)

app.include_router(admin.router)
app.include_router(portfolios.router)
app.include_router(simulate.router)
app.include_router(macro.router)
app.include_router(stripe_webhook.router)
app.include_router(support.router)


@app.get("/", tags=["Health"])
async def root():
    return {
        "status": "online",
        "service": "Macro Risk Engine Backend",
        "docs_url": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}
