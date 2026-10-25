"""OrgObs router — GET/PUT/DELETE for individual OrgOb nodes, plus batch reorder."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_db
from app.models.org_ob import OrgOb

router = APIRouter(prefix="/api/org-obs", tags=["org-obs"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class OrgObUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    parent_id: int | None = None
    meta: dict[str, Any] | None = None
    order_index: int | None = None


class ReorderItem(BaseModel):
    id: int
    order_index: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


# ── Helpers ───────────────────────────────────────────────────────────────────

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


async def _get_org_ob(org_ob_id: int, db: AsyncSession) -> OrgOb:
    # Session.get() doesn't apply the mapper's default selectin eager-load
    # for a self-referential relationship reliably in async mode, so it's
    # requested explicitly here. Two levels: immediate children (returned in
    # the response) plus their own children, needed to compute each child's
    # children_count.
    org_ob = await db.scalar(
        select(OrgOb)
        .options(selectinload(OrgOb.children).selectinload(OrgOb.children))
        .where(OrgOb.id == org_ob_id)
    )
    if not org_ob:
        raise HTTPException(status_code=404, detail="OrgOb not found")
    return org_ob


async def _is_descendant(candidate_parent_id: int, node_id: int, db: AsyncSession) -> bool:
    """Return True if candidate_parent_id is (or descends from) node_id — would create a cycle."""
    visited: set[int] = set()
    current_id: int | None = candidate_parent_id
    while current_id is not None:
        if current_id == node_id:
            return True
        if current_id in visited:
            break
        visited.add(current_id)
        current_id = await db.scalar(select(OrgOb.parent_id).where(OrgOb.id == current_id))
    return False


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/reorder")
async def reorder_org_obs(body: ReorderRequest, db: AsyncSession = Depends(get_db)):
    ids = [item.id for item in body.items]
    rows = await db.execute(select(OrgOb).where(OrgOb.id.in_(ids)))
    ob_map = {o.id: o for o in rows.scalars().all()}
    for item in body.items:
        if item.id in ob_map:
            ob_map[item.id].order_index = item.order_index
    await db.commit()
    return {"message": "Reordered"}


@router.get("/{org_ob_id}")
async def get_org_ob(org_ob_id: int, db: AsyncSession = Depends(get_db)):
    org_ob = await _get_org_ob(org_ob_id, db)
    return {"org_ob": _org_ob_dict(org_ob, include_children=True)}


@router.put("/{org_ob_id}")
async def update_org_ob(org_ob_id: int, body: OrgObUpdate, db: AsyncSession = Depends(get_db)):
    org_ob = await _get_org_ob(org_ob_id, db)

    if body.name is not None:
        org_ob.name = body.name
    if body.description is not None:
        org_ob.description = body.description
    if body.meta is not None:
        org_ob.meta = body.meta
    if body.order_index is not None:
        org_ob.order_index = body.order_index

    if body.parent_id is not None:
        if await _is_descendant(body.parent_id, org_ob.id, db):
            raise HTTPException(
                status_code=400, detail="Cannot set a descendant as parent (would create cycle)"
            )
        new_parent = await db.scalar(
            select(OrgOb).where(OrgOb.id == body.parent_id, OrgOb.reality_id == org_ob.reality_id)
        )
        if not new_parent:
            raise HTTPException(status_code=404, detail="Parent OrgOb not found in same Reality")
        org_ob.parent_id = body.parent_id

    await db.commit()
    await db.refresh(org_ob)
    return {"org_ob": _org_ob_dict(org_ob, include_children=True)}


@router.delete("/{org_ob_id}")
async def delete_org_ob(org_ob_id: int, db: AsyncSession = Depends(get_db)):
    org_ob = await _get_org_ob(org_ob_id, db)
    await db.delete(org_ob)
    await db.commit()
    return {"message": "OrgOb deleted"}
