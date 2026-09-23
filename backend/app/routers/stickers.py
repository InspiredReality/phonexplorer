from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import SessionLocal
from app.services import sticker_crud

router = APIRouter(prefix="/api", tags=["stickers"])


async def get_db():
    async with SessionLocal() as db:
        yield db


class ImageOut(BaseModel):
    id: int
    filename: str
    name: str
    url: str
    tags: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm(cls, img) -> "ImageOut":
        return cls(id=img.id, filename=img.filename, name=img.name or img.filename, url=img.url,
                   tags=[t.name for t in img.tags], created_at=img.created_at)


class TagOut(BaseModel):
    id: int
    name: str
    count: int


class AddTagsRequest(BaseModel):
    tags: list[str]


@router.get("/stickers")
async def list_stickers(
    tags: str | None = Query(default=None),
    mode: str = Query(default="or", pattern="^(and|or)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    untagged: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    tag_list = [t for t in (tags or "").split(",") if t.strip()] if tags else []
    images, total = await sticker_crud.get_images(db, tag_list or None, mode, limit, offset, untagged)
    return {"total": total, "offset": offset, "limit": limit,
            "results": [ImageOut.from_orm(img) for img in images]}


@router.get("/stickers/random")
async def random_sticker(
    tags: str | None = Query(default=None),
    mode: str = Query(default="or", pattern="^(and|or)$"),
    db: AsyncSession = Depends(get_db),
):
    tag_list = [t for t in (tags or "").split(",") if t.strip()] if tags else []
    image = await sticker_crud.get_random_image(db, tag_list or None, mode)
    if not image:
        raise HTTPException(status_code=404, detail="No matching stickers found")
    return ImageOut.from_orm(image)


@router.get("/stickers/tags", response_model=list[TagOut])
async def list_tags(db: AsyncSession = Depends(get_db)):
    return [TagOut(**r) for r in await sticker_crud.get_all_tags_with_counts(db)]


@router.post("/stickers/{image_id}/tags")
async def add_tags_public(
    image_id: int,
    body: AddTagsRequest,
    db: AsyncSession = Depends(get_db),
):
    image = await sticker_crud.add_tags_to_image(db, image_id, body.tags)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return ImageOut.from_orm(image)
