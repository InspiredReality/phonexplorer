from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from app.db import Base
from app.models.tag import reality_tags


class Reality(Base):
    __tablename__ = "realities"

    id          = Column(Integer, primary_key=True)
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
        lazy="selectin",
    )
    tags = relationship(
        "Tag",
        secondary=reality_tags,
        back_populates="realities",
        lazy="selectin",
    )
