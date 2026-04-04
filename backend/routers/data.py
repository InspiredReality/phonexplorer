"""
Data ingest router  –  /api/data/...

This is where you'll add routes that pull from external REST APIs,
transform the response, and return clean data to the React frontend.
"""
from fastapi import APIRouter, HTTPException
from httpx import HTTPStatusError, RequestError

from models.data import FetchRequest, FetchResponse
from services.http_client import client

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/health")
async def health() -> dict:
    """Quick liveness check for this router."""
    return {"status": "ok"}


@router.post("/fetch", response_model=FetchResponse)
async def proxy_fetch(req: FetchRequest) -> FetchResponse:
    """
    Generic proxy endpoint: fetches any external REST URL and returns
    its JSON response.  Add authentication headers in req.headers as needed.

    Use this as a pattern to build dedicated, typed endpoints per data source.
    """
    try:
        resp = await client.get(req.url, params=req.params, headers=req.headers)
        resp.raise_for_status()
        return FetchResponse(status_code=resp.status_code, data=resp.json())
    except HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
    except RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {exc}")
