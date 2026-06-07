import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import SessionLocal
from models.scene_object import SceneObject

router = APIRouter(prefix="/api/objects", tags=["objects"])


# ── DB dependency ─────────────────────────────────────────────────────────────

async def get_db():
    async with SessionLocal() as session:
        yield session


# ── Schemas ───────────────────────────────────────────────────────────────────

class ObjectCreate(BaseModel):
    shape: str
    title: str
    description: str = ""
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    color: str = "#4488ff"


class RelationshipAdd(BaseModel):
    related_id: uuid.UUID


class ObjectOut(BaseModel):
    id: uuid.UUID
    shape: str
    title: str
    description: str
    x: float
    y: float
    z: float
    color: str
    relationships: list[uuid.UUID]

    model_config = {"from_attributes": True}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ObjectOut])
async def list_objects(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(SceneObject))
    return rows.scalars().all()


@router.post("", response_model=ObjectOut, status_code=201)
async def create_object(body: ObjectCreate, db: AsyncSession = Depends(get_db)):
    obj = SceneObject(**body.model_dump(), relationships=[])
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.post("/{obj_id}/relationships", response_model=ObjectOut)
async def add_relationship(
    obj_id: uuid.UUID,
    body: RelationshipAdd,
    db: AsyncSession = Depends(get_db),
):
    obj = await db.get(SceneObject, obj_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    existing = list(obj.relationships or [])
    if body.related_id not in existing:
        obj.relationships = existing + [body.related_id]

    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{obj_id}", status_code=204)
async def delete_object(obj_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    obj = await db.get(SceneObject, obj_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")
    await db.delete(obj)
    await db.commit()
