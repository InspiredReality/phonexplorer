"""
Pydantic schemas for data ingest / manipulation payloads.
Add new schemas here as you integrate external data sources.
"""
from typing import Any

from pydantic import BaseModel


class FetchRequest(BaseModel):
    """Generic request to proxy/fetch from an external REST endpoint."""
    url: str
    params: dict[str, Any] | None = None
    headers: dict[str, str] | None = None


class FetchResponse(BaseModel):
    status_code: int
    data: Any
