import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.models.org_ob import OrgOb
from app.models.reality import Reality
from app.models.tag import Tag

router = APIRouter(prefix="/api/realities", tags=["realities"])

UPLOADS_DIR = Path("uploads/realities")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


# ── Schemas ───────────────────────────────────────────────────────────────────

class RealityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class RealityUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = None
    width_m: float | None = None
    length_m: float | None = None
    tag_ids: list[int] | None = None
    meta: dict[str, Any] | None = None


class OrgObCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    parent_id: int | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    order_index: int = 0


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tag_dict(tag: Tag) -> dict:
    return {"id": tag.id, "name": tag.name, "color": tag.color}


def _org_ob_dict(org_ob: OrgOb, include_children: bool = False) -> dict:
    data: dict = {
        "id":             org_ob.id,
        "reality_id":     org_ob.reality_id,
        "parent_id":      org_ob.parent_id,
        "name":           org_ob.name,
        "description":    org_ob.description,
        "meta":           org_ob.meta or {},
        "order_index":    org_ob.order_index,
        "children_count": len(org_ob.children),
        "created_at":     org_ob.created_at.isoformat() if org_ob.created_at else None,
        "updated_at":     org_ob.updated_at.isoformat() if org_ob.updated_at else None,
    }
    if include_children:
        data["children"] = [_org_ob_dict(c) for c in org_ob.children]
    return data


async def _reality_dict(reality: Reality, db: AsyncSession) -> dict:
    count = await db.scalar(
        select(func.count(OrgOb.id)).where(OrgOb.reality_id == reality.id)
    )
    return {
        "id":           reality.id,
        "name":         reality.name,
        "description":  reality.description,
        "image_path":   reality.image_path,
        "width_m":      reality.width_m,
        "length_m":     reality.length_m,
        "tags":         [_tag_dict(t) for t in reality.tags],
        "meta":         reality.meta or {},
        "org_ob_count": count or 0,
        "created_at":   reality.created_at.isoformat() if reality.created_at else None,
        "updated_at":   reality.updated_at.isoformat() if reality.updated_at else None,
    }


async def _get_reality(reality_id: int, db: AsyncSession) -> Reality:
    reality = await db.get(Reality, reality_id)
    if not reality:
        raise HTTPException(status_code=404, detail="Reality not found")
    return reality


# ── Reality routes ────────────────────────────────────────────────────────────

@router.get("")
async def list_realities(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(Reality).order_by(Reality.created_at.desc()))
    realities = rows.scalars().all()
    return {"realities": [await _reality_dict(r, db) for r in realities]}


@router.post("", status_code=201)
async def create_reality(body: RealityCreate, db: AsyncSession = Depends(get_db)):
    reality = Reality(name=body.name, description=body.description, meta=body.meta)
    db.add(reality)
    await db.commit()
    await db.refresh(reality)
    return {"reality": await _reality_dict(reality, db)}


@router.get("/{reality_id}")
async def get_reality(reality_id: int, db: AsyncSession = Depends(get_db)):
    reality = await _get_reality(reality_id, db)
    return {"reality": await _reality_dict(reality, db)}


@router.put("/{reality_id}")
async def update_reality(
    reality_id: int, body: RealityUpdate, db: AsyncSession = Depends(get_db)
):
    reality = await _get_reality(reality_id, db)

    if body.name is not None:
        reality.name = body.name
    if body.description is not None:
        reality.description = body.description
    if body.width_m is not None:
        reality.width_m = body.width_m
    if body.length_m is not None:
        reality.length_m = body.length_m
    if body.meta is not None:
        reality.meta = body.meta

    if body.tag_ids is not None:
        tags = (await db.execute(select(Tag).where(Tag.id.in_(body.tag_ids)))).scalars().all()
        reality.tags = list(tags)

    await db.commit()
    await db.refresh(reality)
    return {"reality": await _reality_dict(reality, db)}


@router.post("/{reality_id}/image")
async def upload_reality_image(
    reality_id: int,
    image: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    reality = await _get_reality(reality_id, db)

    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(image.filename or "image.jpg").suffix or ".jpg"
    filename = f"reality_{reality_id}{suffix}"
    dest = UPLOADS_DIR / filename

    data = await image.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    dest.write_bytes(data)

    reality.image_path = f"realities/{filename}"
    await db.commit()
    await db.refresh(reality)
    return {"reality": await _reality_dict(reality, db)}


@router.delete("/{reality_id}")
async def delete_reality(reality_id: int, db: AsyncSession = Depends(get_db)):
    reality = await _get_reality(reality_id, db)
    if reality.image_path:
        try:
            Path(f"uploads/{reality.image_path}").unlink(missing_ok=True)
        except Exception:
            pass
    await db.delete(reality)
    await db.commit()
    return {"message": "Reality deleted"}


# ── OrgOb sub-routes ──────────────────────────────────────────────────────────

@router.get("/{reality_id}/org-obs")
async def list_top_level_org_obs(reality_id: int, db: AsyncSession = Depends(get_db)):
    await _get_reality(reality_id, db)
    rows = await db.execute(
        select(OrgOb)
        .where(OrgOb.reality_id == reality_id, OrgOb.parent_id.is_(None))
        .order_by(OrgOb.order_index)
    )
    top_level = rows.scalars().all()
    return {"org_obs": [_org_ob_dict(o, include_children=True) for o in top_level]}


@router.post("/{reality_id}/org-obs", status_code=201)
async def create_org_ob(
    reality_id: int, body: OrgObCreate, db: AsyncSession = Depends(get_db)
):
    await _get_reality(reality_id, db)

    if body.parent_id is not None:
        parent = await db.scalar(
            select(OrgOb).where(OrgOb.id == body.parent_id, OrgOb.reality_id == reality_id)
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Parent OrgOb not found")

    org_ob = OrgOb(
        reality_id=reality_id,
        parent_id=body.parent_id,
        name=body.name,
        description=body.description,
        meta=body.meta,
        order_index=body.order_index,
    )
    db.add(org_ob)
    await db.commit()
    await db.refresh(org_ob)
    return {"org_ob": _org_ob_dict(org_ob, include_children=True)}
