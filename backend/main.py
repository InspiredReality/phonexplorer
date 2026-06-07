"""
PhoneExplorer  –  FastAPI backend
Run:  uvicorn main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import data, monday
from services.http_client import client


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: nothing extra needed — httpx client is module-level
    yield
    # Shutdown: close the shared HTTP client cleanly
    await client.aclose()


app = FastAPI(
    title="PhoneExplorer API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(monday.router)


@app.get("/health")
async def root_health() -> dict:
    return {"status": "ok", "service": "phonexplorer-api"}
