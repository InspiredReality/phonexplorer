"""
Shared async HTTP client (httpx).

Import `client` anywhere in the app.  It is created once at startup and
closed at shutdown via the FastAPI lifespan, so connections are reused
across requests (connection pooling).
"""
import httpx

# Single shared client — reuses TCP connections across requests
client = httpx.AsyncClient(
    timeout=httpx.Timeout(10.0, connect=5.0),
    follow_redirects=True,
)
