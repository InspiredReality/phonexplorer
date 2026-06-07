"""OrgObs router — GET/PUT/DELETE for individual OrgOb nodes."""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.models.reality import Reality
from app.models.org_ob import OrgOb
from app.routers.auth import get_current_user

router = APIRouter()


# ----------------------------
# Schemas
# ----------------------------
class OrgObUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = None
    parent_id: Optional[int] = None
    meta: Optional[Dict[str, Any]] = None
    order_index: Optional[int] = None


class ReorderItem(BaseModel):
    id: int
    order_index: int


class ReorderRequest(BaseModel):
    items: List[ReorderItem]


# ----------------------------
# Helpers
# ----------------------------
def _get_owned_org_ob(org_ob_id: int, user_id: int, db: Session) -> OrgOb:
    """Fetch an OrgOb and verify ownership via its Reality."""
    org_ob = (
        db.query(OrgOb)
        .join(Reality, OrgOb.reality_id == Reality.id)
        .filter(OrgOb.id == org_ob_id, Reality.user_id == user_id)
        .first()
    )
    if not org_ob:
        raise HTTPException(status_code=404, detail="OrgOb not found")
    return org_ob


def _is_descendant(candidate_parent_id: int, node_id: int, db: Session) -> bool:
    """Return True if candidate_parent_id is a descendant of node_id (would create a cycle)."""
    visited = set()
    current_id = candidate_parent_id
    while current_id is not None:
        if current_id == node_id:
            return True
        if current_id in visited:
            break
        visited.add(current_id)
        row = db.query(OrgOb.parent_id).filter(OrgOb.id == current_id).first()
        current_id = row[0] if row else None
    return False


# ----------------------------
# Routes
# ----------------------------
@router.post("/reorder", status_code=200)
def reorder_org_obs(
    payload: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Batch-update order_index for a set of OrgObs owned by the current user."""
    ids = [item.id for item in payload.items]
    org_obs = (
        db.query(OrgOb)
        .join(Reality, OrgOb.reality_id == Reality.id)
        .filter(OrgOb.id.in_(ids), Reality.user_id == current_user.id)
        .all()
    )
    ob_map = {o.id: o for o in org_obs}
    for item in payload.items:
        if item.id in ob_map:
            ob_map[item.id].order_index = item.order_index
    db.commit()
    return {"message": "Reordered"}


@router.get("/{org_ob_id}", status_code=200)
def get_org_ob(
    org_ob_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_ob = _get_owned_org_ob(org_ob_id, current_user.id, db)
    return {"org_ob": org_ob.to_dict(include_children=True)}


@router.put("/{org_ob_id}", status_code=200)
def update_org_ob(
    org_ob_id: int,
    payload: OrgObUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_ob = _get_owned_org_ob(org_ob_id, current_user.id, db)

    if payload.name is not None:
        org_ob.name = payload.name
    if payload.description is not None:
        org_ob.description = payload.description
    if payload.meta is not None:
        org_ob.meta = payload.meta
    if payload.order_index is not None:
        org_ob.order_index = payload.order_index

    # Re-parenting: validate new parent is in same reality and not a descendant
    if payload.parent_id is not None:
        if _is_descendant(payload.parent_id, org_ob_id, db):
            raise HTTPException(
                status_code=400, detail="Cannot set a descendant as parent (would create cycle)"
            )
        new_parent = (
            db.query(OrgOb)
            .filter_by(id=payload.parent_id, reality_id=org_ob.reality_id)
            .first()
        )
        if not new_parent:
            raise HTTPException(status_code=404, detail="Parent OrgOb not found in same Reality")
        org_ob.parent_id = payload.parent_id

    db.commit()
    db.refresh(org_ob)
    return {"message": "OrgOb updated", "org_ob": org_ob.to_dict(include_children=True)}


@router.delete("/{org_ob_id}", status_code=200)
def delete_org_ob(
    org_ob_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_ob = _get_owned_org_ob(org_ob_id, current_user.id, db)
    db.delete(org_ob)
    db.commit()
    return {"message": "OrgOb deleted"}
