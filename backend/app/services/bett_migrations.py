"""One-time data migrations for Bett Stuff, tracked in app_migrations so each runs once."""
import json
import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bett_stuff_settlement import BettStuffSettlement

LIVE_TAGS_MIGRATION = "bett_stuff_live_tag_to_when"


async def migrate_live_tags(db: AsyncSession) -> int:
    """Turn the old "live" / "Live" tags into When = Live.

    Bets carrying a tag that is exactly "live" (any case) get bet_when set to
    "live" and that tag removed; every other tag is kept. Runs once — the marker
    row means a "live" tag added later is left alone. Returns bets changed.
    """
    await db.execute(text("CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(128) PRIMARY KEY)"))
    done = await db.scalar(
        text("SELECT 1 FROM app_migrations WHERE name = :n"), {"n": LIVE_TAGS_MIGRATION}
    )
    if done:
        await db.rollback()
        return 0

    changed = 0
    rows = (await db.execute(select(BettStuffSettlement))).scalars().all()
    for row in rows:
        try:
            tags = json.loads(row.tags) if row.tags else []
        except ValueError:
            continue
        kept = [t for t in tags if str(t).strip().lower() != "live"]
        if len(kept) != len(tags):
            row.tags = json.dumps(kept)
            row.bet_when = "live"
            changed += 1

    await db.execute(text("INSERT INTO app_migrations (name) VALUES (:n)"), {"n": LIVE_TAGS_MIGRATION})
    await db.commit()
    logging.info("Bett Stuff live-tag migration: %d bets updated", changed)
    return changed
