from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table
from sqlalchemy.orm import relationship

from app.db import Base

reality_tags = Table(
    "reality_tags",
    Base.metadata,
    Column("reality_id", Integer, ForeignKey("realities.id",      ondelete="CASCADE"), primary_key=True),
    Column("tag_id",     Integer, ForeignKey("reality_labels.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    # Named "reality_labels" (not "tags") to avoid colliding with the
    # unrelated sticker/image Tag model, which already owns the "tags" table.
    __tablename__ = "reality_labels"

    id         = Column(Integer, primary_key=True)
    name       = Column(String(50), nullable=False, unique=True)
    color      = Column(String(7), default="#6366f1")
    created_at = Column(DateTime, default=datetime.utcnow)

    realities = relationship("Reality", secondary=reality_tags, back_populates="tags")
