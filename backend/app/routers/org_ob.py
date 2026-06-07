"""OrgOb model — one object inside a Reality org hierarchy (self-referential tree)."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship, backref

from app.db import Base


class OrgOb(Base):
    __tablename__ = "org_obs"

    id          = Column(Integer, primary_key=True)
    reality_id  = Column(Integer, ForeignKey("realities.id"), nullable=False, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=False)
    parent_id   = Column(
        Integer,
        ForeignKey("org_obs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )  # NULL = top-level within this Reality
    name        = Column(String(200), nullable=False)
    description = Column(Text)
    meta        = Column(JSON, default=dict)
    order_index = Column(Integer, default=0, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Self-referential: one parent → many children
    children = relationship(
        "OrgOb",
        backref=backref("parent", remote_side=[id]),
        order_by="OrgOb.order_index",
        cascade="all, delete-orphan",
    )
    reality = relationship("Reality", back_populates="org_obs")

    def to_dict(self, include_children: bool = False):
        data = {
            "id":             self.id,
            "reality_id":     self.reality_id,
            "parent_id":      self.parent_id,
            "name":           self.name,
            "description":    self.description,
            "meta":           self.meta or {},
            "order_index":    self.order_index,
            "children_count": len(self.children),
            "created_at":     self.created_at.isoformat() if self.created_at else None,
            "updated_at":     self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_children:
            data["children"] = [c.to_dict() for c in self.children]
        return data

    def __repr__(self):
        return f"<OrgOb {self.name}>"
