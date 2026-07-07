from sqlalchemy import Column, Integer, Text, ForeignKey, TIMESTAMP, func, Table
from sqlalchemy.orm import relationship
from app.db import Base

image_tags = Table(
    "image_tags",
    Base.metadata,
    Column("image_id", Integer, ForeignKey("images.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True)
    filename = Column(Text, unique=True, nullable=False)
    url = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    tags = relationship("Tag", secondary=image_tags, back_populates="images", lazy="selectin")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    name = Column(Text, unique=True, nullable=False)

    images = relationship("Image", secondary=image_tags, back_populates="tags", lazy="selectin")
