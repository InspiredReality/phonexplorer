"""Reality model — top-level container for an org hierarchy."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship

from app.db import Base


class Reality(Base):
    __tablename__ = "realities"

    id          = Column(Integer, primary_key=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name        = Column(String(100), nullable=False)
    description = Column(Text)
    image_path  = Column(String(500), nullable=True)
    width_m     = Column(Float, nullable=True)
    length_m    = Column(Float, nullable=True)
    meta        = Column(JSON, default=dict)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    org_obs = relationship(
        "OrgOb",
        back_populates="reality",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    # imported here to avoid circular import at module level
    tags = relationship(
        "Tag",
        secondary="reality_tags",
        back_populates="realities",
        lazy="select",
    )

    def to_dict(self):
        return {
            "id":           self.id,
            "user_id":      self.user_id,
            "name":         self.name,
            "description":  self.description,
            "image_path":   self.image_path,
            "width_m":      self.width_m,
            "length_m":     self.length_m,
            "tags":         [t.to_dict() for t in self.tags],
            "meta":         self.meta or {},
            "org_ob_count": self.org_obs.count(),
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "updated_at":   self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<Reality {self.name}>"
