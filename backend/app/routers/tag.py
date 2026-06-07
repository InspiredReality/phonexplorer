"""Tag model — user-scoped labels reusable across all reality nodes."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship

from app.db import Base

# Association table: many realities ↔ many tags
reality_tags = Table(
    "reality_tags",
    Base.metadata,
    Column("reality_id", Integer, ForeignKey("realities.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id",     Integer, ForeignKey("tags.id",      ondelete="CASCADE"), primary_key=True),
)


class Tag(Base):
    __tablename__ = "tags"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name       = Column(String(50), nullable=False)
    color      = Column(String(7), default="#6366f1")   # hex, e.g. '#6366f1'
    created_at = Column(DateTime, default=datetime.utcnow)

    realities  = relationship("Reality", secondary=reality_tags, back_populates="tags")

    def to_dict(self):
        return {
            "id":         self.id,
            "user_id":    self.user_id,
            "name":       self.name,
            "color":      self.color,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<Tag {self.name}>"
