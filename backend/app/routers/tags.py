from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.models.tag import Tag

router = APIRouter(prefix="/api/tags", tags=["tags"])


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    color: str = "#6366f1"


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    color: str | None = None


def _tag_dict(tag: Tag) -> dict:
    return {
        "id":         tag.id,
        "name":       tag.name,
        "color":      tag.color,
        "created_at": tag.created_at.isoformat() if tag.created_at else None,
    }


@router.get("")
async def list_tags(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(Tag).order_by(Tag.name))
    return {"tags": [_tag_dict(t) for t in rows.scalars().all()]}


@router.post("", status_code=201)
async def create_tag(body: TagCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(Tag).where(Tag.name == body.name))
    if existing:
        return {"tag": _tag_dict(existing)}
    tag = Tag(name=body.name, color=body.color)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return {"tag": _tag_dict(tag)}


@router.put("/{tag_id}")
async def update_tag(tag_id: int, body: TagUpdate, db: AsyncSession = Depends(get_db)):
    tag = await db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if body.name is not None:
        tag.name = body.name
    if body.color is not None:
        tag.color = body.color
    await db.commit()
    await db.refresh(tag)
    return {"tag": _tag_dict(tag)}


@router.delete("/{tag_id}")
async def delete_tag(tag_id: int, db: AsyncSession = Depends(get_db)):
    tag = await db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.delete(tag)
    await db.commit()
    return {"message": "Tag deleted"}
