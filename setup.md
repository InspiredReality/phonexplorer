# Project Auto-Deploy Setup Guide

> **For Claude Code:** When the user says "read setup.md to setup new project" (or similar), execute every step in this file top-to-bottom. Create all files, run all commands, commit, and push. Then print the **Manual Dashboard Steps** section for the user to action.

---

## What This Sets Up

| Layer | Platform | Trigger |
|-------|----------|---------|
| React frontend | Vercel | Push to any branch |
| FastAPI backend | Railway | Push to any branch |

---

## Step 1 — FastAPI Backend Boilerplate

Create the following directory structure and files exactly.

### 1a. Create directories

```bash
mkdir -p backend/{routers,services,models}
```

### 1b. `backend/requirements.txt`

```
fastapi==0.115.6
uvicorn[standard]==0.32.1
httpx==0.28.1
pydantic==2.10.3
pydantic-settings==2.7.0
python-dotenv==1.0.1
```

### 1c. `backend/config.py`

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    port: int = 8000

    # Comma-separated origins — works with Railway/Vercel env var dashboards
    # e.g. ALLOWED_ORIGINS_RAW=http://localhost:3000,https://yourapp.vercel.app
    allowed_origins_raw: str = "http://localhost:3000"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]


settings = Settings()
```

### 1d. `backend/services/__init__.py`

```python
```

### 1e. `backend/services/http_client.py`

```python
"""
Shared async HTTP client (httpx).
Single instance created at module load; closed at app shutdown via lifespan.
Import `client` anywhere in the app — connections are pooled automatically.
"""
import httpx

client = httpx.AsyncClient(
    timeout=httpx.Timeout(10.0, connect=5.0),
    follow_redirects=True,
)
```

### 1f. `backend/models/__init__.py`

```python
```

### 1g. `backend/models/data.py`

```python
"""Pydantic models for data ingest payloads. Add new models per data source."""
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
```

### 1h. `backend/routers/__init__.py`

```python
```

### 1i. `backend/routers/data.py`

```python
"""
Data ingest router  –  /api/data/...
Pattern: add dedicated typed routes here per external data source.
"""
from fastapi import APIRouter, HTTPException
from httpx import HTTPStatusError, RequestError

from models.data import FetchRequest, FetchResponse
from services.http_client import client

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.post("/fetch", response_model=FetchResponse)
async def proxy_fetch(req: FetchRequest) -> FetchResponse:
    """Generic proxy: fetches external REST URL, returns JSON."""
    try:
        resp = await client.get(req.url, params=req.params, headers=req.headers)
        resp.raise_for_status()
        return FetchResponse(status_code=resp.status_code, data=resp.json())
    except HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
    except RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {exc}")
```

### 1j. `backend/main.py`

```python
"""
FastAPI backend entry point.
Run locally: uvicorn main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import data
from services.http_client import client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await client.aclose()


app = FastAPI(
    title="API",
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


@app.get("/health")
async def root_health() -> dict:
    return {"status": "ok"}
```

### 1k. `backend/.env.example`

```
# Copy to .env — never commit .env

# Comma-separated frontend origins
ALLOWED_ORIGINS_RAW=http://localhost:3000,https://your-app.vercel.app

# Add API keys here as you integrate external services
# EXAMPLE_API_KEY=
# EXAMPLE_API_BASE_URL=https://api.example.com
```

### 1l. `backend/.gitignore`

```
.env
__pycache__/
*.pyc
*.pyo
.venv/
venv/
```

---

## Step 2 — Railway Config Files

### 2a. `railway.json` (repo root)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### 2b. `backend/Procfile`

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

### 2c. `backend/.python-version`

```
3.11
```

### 2d. `backend/nixpacks.toml`

```toml
[phases.install]
cmds = ["pip install -r requirements.txt"]

[start]
cmd = "uvicorn main:app --host 0.0.0.0 --port $PORT"
```

---

## Step 3 — Vercel Config File

### 3a. `vercel.json` (repo root)

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "build",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

> The `rewrites` entry makes React Router work correctly — all paths serve `index.html`.

---

## Step 4 — CRA Dev Proxy (optional but recommended)

If the frontend uses Create React App, add this to `package.json` so `/api/*` calls proxy to the local FastAPI server during development:

```json
"proxy": "http://localhost:8000"
```

---

## Step 5 — Install, Smoke-Test, Commit & Push

```bash
# Install backend deps
pip install -r backend/requirements.txt

# Smoke-test: server must start cleanly
cd backend && timeout 5 uvicorn main:app --port 8001 && cd ..

# Stage and commit everything
git add .
git commit -m "Add FastAPI backend + Vercel + Railway auto-deploy config"
git push
```

---

## Manual Dashboard Steps (print these for the user after running the above)

These steps require browser access and cannot be automated by Claude Code.

### Vercel (frontend)

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import this GitHub repo
3. Vercel auto-detects Create React App — no build settings to change
4. Click **Deploy**
5. Every push to any branch now triggers a Vercel preview deployment
6. Note your production URL (e.g. `https://yourapp.vercel.app`)

### Railway (backend)

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select this repo
3. In **Settings → Root Directory** → set to `backend`
4. In **Settings → Variables** add:
   ```
   ALLOWED_ORIGINS_RAW=http://localhost:3000,https://yourapp.vercel.app
   ```
   (Replace with your actual Vercel URL. Railway auto-injects `PORT`.)
5. Railway gives you a public URL like `https://yourapi.railway.app`
6. Go back to **Vercel → Settings → Environment Variables** and add:
   ```
   REACT_APP_API_URL=https://yourapi.railway.app
   ```

Every push to the branch now auto-deploys both Vercel (frontend) and Railway (backend).

---

## Local Development

```bash
# Terminal 1 — backend
cd backend
cp .env.example .env   # fill in values
uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
npm start              # proxies /api/* to localhost:8000 automatically
```

API docs auto-generated at: `http://localhost:8000/docs`
