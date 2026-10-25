from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import backref, relationship

from app.db import Base
from app.models.tag import org_ob_tags


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
    image_path  = Column(String(500), nullable=True)
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
    # Fully-qualified path: see the note on Reality.tags about the ambiguous "Tag" name.
    tags = relationship(
        "app.models.tag.Tag",
        secondary=org_ob_tags,
        back_populates="org_obs",
        lazy="selectin",
    )
