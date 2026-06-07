from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import backref, relationship

from app.db import Base


class OrgOb(Base):
    __tablename__ = "org_obs"

    id          = Column(Integer, primary_key=True)
    reality_id  = Column(Integer, ForeignKey("realities.id"), nullable=False, index=True)
    parent_id   = Column(
        Integer,
        ForeignKey("org_obs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name        = Column(String(200), nullable=False)
    description = Column(Text)
    meta        = Column(JSON, default=dict)
    order_index = Column(Integer, default=0, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    children = relationship(
        "OrgOb",
        backref=backref("parent", remote_side=[id]),
        order_by="OrgOb.order_index",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    reality = relationship("Reality", back_populates="org_obs")
