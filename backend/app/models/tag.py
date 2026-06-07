from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table
from sqlalchemy.orm import relationship

from app.db import Base

reality_tags = Table(
    "reality_tags",
    Base.metadata,
    Column("reality_id", Integer, ForeignKey("realities.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id",     Integer, ForeignKey("tags.id",      ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id         = Column(Integer, primary_key=True)
    name       = Column(String(50), nullable=False, unique=True)
    color      = Column(String(7), default="#6366f1")
    created_at = Column(DateTime, default=datetime.utcnow)

    realities = relationship("Reality", secondary=reality_tags, back_populates="tags")
