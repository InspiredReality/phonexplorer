from fastapi import APIRouter, Depends, HTTPException, Query, Request, Header
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path
from app.db import SessionLocal
from app.config import settings
from app.services import sticker_crud, github_sync

router = APIRouter(tags=["admin"])

templates = Jinja2Templates(directory=str(Path(__file__).parent.parent / "templates"))


async def get_db():
    async with SessionLocal() as db:
        yield db


def require_admin(authorization: str | None = Header(default=None)):
    if not settings.admin_token or authorization != f"Bearer {settings.admin_token}":
        raise HTTPException(status_code=401, detail="Unauthorized")


class AddTagsRequest(BaseModel):
    tags: list[str]


class BulkAddTagsRequest(BaseModel):
    image_ids: list[int]
    tags: list[str]


class RenameImageRequest(BaseModel):
    name: str


@router.get("/admin", response_class=HTMLResponse)
async def admin_page(
    request: Request,
    tag: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    images = await sticker_crud.get_all_images_for_admin(db, tag)
    all_tags = await sticker_crud.get_all_tags_with_counts(db)
    return templates.TemplateResponse("admin.html", {
        "request": request,
        "images": images,
        "all_tags": all_tags,
        "filter_tag": tag or "",
    })


@router.post("/admin/sync-images")
async def sync_images(db: AsyncSession = Depends(get_db), _: None = Depends(require_admin)):
    result = await github_sync.sync_images_from_github(db)
    return result


@router.post("/admin/images/{image_id}/tags")
async def add_tags(
    image_id: int,
    body: AddTagsRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    image = await sticker_crud.add_tags_to_image(db, image_id, body.tags)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return {"id": image.id, "tags": [t.name for t in image.tags]}


@router.post("/admin/images/bulk-tags")
async def bulk_add_tags(
    body: BulkAddTagsRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    updated = await sticker_crud.add_tags_to_images(db, body.image_ids, body.tags)
    return {"updated": updated}


@router.patch("/api/admin/images/{image_id}/name")
async def rename_image(
    image_id: int,
    body: RenameImageRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    image = await sticker_crud.rename_image(db, image_id, body.name)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return {"id": image.id, "name": image.name or image.filename}


@router.delete("/admin/images/{image_id}/tags/{tag_name}", status_code=204)
async def remove_tag(
    image_id: int,
    tag_name: str,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
):
    if not await sticker_crud.remove_tag_from_image(db, image_id, tag_name):
        raise HTTPException(status_code=404, detail="Tag not found on image")
