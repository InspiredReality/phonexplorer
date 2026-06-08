"""
PhoneExplorer  –  FastAPI application
Entry point: run.py (backend root)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from app.config import settings
from app.db import Base, SessionLocal, engine
from app.models.scene_object import SceneObject
from app.routers import data, monday, objects
from app.services.http_client import client


# ── Seed data (mirrors the original hard-coded buildScene() positions) ─────────

def _seeded_rnd(seed: int) -> list[float]:
    results, s = [], seed
    for _ in range(100):
        s = (s * 9301 + 49297) % 233280
        results.append((s / 233280) * 20 - 10)
    return results


_rnd = _seeded_rnd(42)

_SHAPES = [
    (
        "sphere", "#4488ff", "Sphere",
        "A perfectly round geometric solid. Every point on its surface is equidistant from the center.",
        4,
    ),
    (
        "cube", "#ff6644", "Cube",
        "A regular hexahedron with 6 square faces, 12 edges, and 8 vertices. One of the five Platonic solids.",
        5,
    ),
    (
        "tetrahedron", "#44cc88", "Tetrahedron",
        "The simplest polyhedron — 4 triangular faces, 6 edges, 4 vertices. The 3D analog of the triangle.",
        3,
    ),
]

_SEED_OBJECTS: list[dict] = []
_ri = 0
for _shape, _color, _title_base, _desc, _count in _SHAPES:
    for _i in range(_count):
        _SEED_OBJECTS.append(dict(
            shape=_shape,
            title=f"{_title_base} {_i + 1}",
            description=_desc,
            x=_rnd[_ri], y=_rnd[_ri + 1], z=_rnd[_ri + 2],
            color=_color,
            relationships=[],
        ))
        _ri += 3


# ── App lifecycle ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with SessionLocal() as db:
            count = await db.scalar(select(func.count()).select_from(SceneObject))
            if count == 0:
                db.add_all(SceneObject(**row) for row in _SEED_OBJECTS)
                await db.commit()
    except Exception as exc:
        logging.error("DB startup error — app running without database: %s", exc)

    yield

    await client.aclose()


app = FastAPI(
    title="PhoneExplorer API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    # Allow any Vercel preview deployment URL for this project
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(monday.router)
app.include_router(objects.router)


@app.get("/health")
async def root_health() -> dict:
    return {"status": "ok", "service": "phonexplorer-api"}
