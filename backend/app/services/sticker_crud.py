import random
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.orm import selectinload
from app.models.sticker import Image, Tag, image_tags


async def get_or_create_tag(db: AsyncSession, name: str) -> Tag:
    name = name.strip().lower()
    tag = (await db.execute(select(Tag).where(Tag.name == name))).scalar_one_or_none()
    if not tag:
        tag = Tag(name=name)
        db.add(tag)
        await db.flush()
    return tag


async def get_all_tags_with_counts(db: AsyncSession) -> list[dict]:
    stmt = (
        select(Tag.id, Tag.name, func.count(image_tags.c.image_id).label("count"))
        .outerjoin(image_tags, Tag.id == image_tags.c.tag_id)
        .group_by(Tag.id, Tag.name)
        .order_by(Tag.name)
    )
    return [{"id": r.id, "name": r.name, "count": r.count} for r in await db.execute(stmt)]


def _tag_filter_subquery(tags: list[str], mode: str):
    names = [t.strip().lower() for t in tags if t.strip()]
    if not names:
        return None
    if mode == "and":
        return (
            select(image_tags.c.image_id)
            .join(Tag, Tag.id == image_tags.c.tag_id)
            .where(Tag.name.in_(names))
            .group_by(image_tags.c.image_id)
            .having(func.count(func.distinct(Tag.name)) == len(names))
            .subquery()
        )
    return (
        select(image_tags.c.image_id)
        .join(Tag, Tag.id == image_tags.c.tag_id)
        .where(Tag.name.in_(names))
        .distinct()
        .subquery()
    )


async def get_images(
    db: AsyncSession,
    tags: list[str] | None,
    mode: str = "or",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Image], int]:
    stmt = select(Image).options(selectinload(Image.tags))
    count_stmt = select(func.count()).select_from(Image)
    if tags:
        subq = _tag_filter_subquery(tags, mode)
        if subq is not None:
            stmt = stmt.where(Image.id.in_(subq))
            count_stmt = count_stmt.where(Image.id.in_(subq))
    total = (await db.execute(count_stmt)).scalar_one()
    images = (await db.execute(stmt.order_by(Image.id).limit(limit).offset(offset))).scalars().all()
    return images, total


async def get_random_image(db: AsyncSession, tags: list[str] | None, mode: str = "or") -> Image | None:
    stmt = select(Image.id)
    if tags:
        subq = _tag_filter_subquery(tags, mode)
        if subq is not None:
            stmt = stmt.where(Image.id.in_(subq))
    ids = (await db.execute(stmt)).scalars().all()
    if not ids:
        return None
    chosen = random.choice(ids)
    return (await db.execute(
        select(Image).options(selectinload(Image.tags)).where(Image.id == chosen)
    )).scalar_one_or_none()


async def add_tags_to_image(db: AsyncSession, image_id: int, tag_names: list[str]) -> Image | None:
    image = (await db.execute(
        select(Image).options(selectinload(Image.tags)).where(Image.id == image_id)
    )).scalar_one_or_none()
    if not image:
        return None
    existing = {t.name for t in image.tags}
    for name in tag_names:
        name = name.strip().lower()
        if name and name not in existing:
            image.tags.append(await get_or_create_tag(db, name))
    await db.commit()
    await db.refresh(image)
    return image


async def add_tags_to_images(db: AsyncSession, image_ids: list[int], tag_names: list[str]) -> list[int]:
    names = [n.strip().lower() for n in tag_names if n.strip()]
    if not image_ids or not names:
        return []
    tags = [await get_or_create_tag(db, name) for name in names]
    images = (await db.execute(
        select(Image).options(selectinload(Image.tags)).where(Image.id.in_(image_ids))
    )).scalars().all()
    for image in images:
        existing = {t.name for t in image.tags}
        for tag in tags:
            if tag.name not in existing:
                image.tags.append(tag)
    await db.commit()
    return [img.id for img in images]


async def remove_tag_from_image(db: AsyncSession, image_id: int, tag_name: str) -> bool:
    tag = (await db.execute(select(Tag).where(Tag.name == tag_name.strip().lower()))).scalar_one_or_none()
    if not tag:
        return False
    await db.execute(
        delete(image_tags).where(
            image_tags.c.image_id == image_id,
            image_tags.c.tag_id == tag.id,
        )
    )
    await db.commit()
    return True


async def upsert_image(db: AsyncSession, filename: str, url: str) -> tuple[Image, bool]:
    existing = (await db.execute(select(Image).where(Image.filename == filename))).scalar_one_or_none()
    if existing:
        if existing.url != url:
            existing.url = url
        return existing, False
    img = Image(filename=filename, url=url)
    db.add(img)
    await db.flush()
    return img, True


async def get_all_images_for_admin(db: AsyncSession, tag_filter: str | None = None) -> list[Image]:
    stmt = select(Image).options(selectinload(Image.tags))
    if tag_filter:
        tags = [t.strip().lower() for t in tag_filter.split(",") if t.strip()]
        if tags:
            subq = _tag_filter_subquery(tags, "or")
            if subq is not None:
                stmt = stmt.where(Image.id.in_(subq))
    images = (await db.execute(stmt)).scalars().all()
    return sorted(images, key=lambda img: (len(img.tags) > 0, img.filename))
