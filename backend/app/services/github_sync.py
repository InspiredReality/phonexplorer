import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.services.sticker_crud import upsert_image


async def sync_images_from_github(db: AsyncSession) -> dict:
    # The Contents API caps directory listings around 1,000 entries, which
    # this repo will exceed. The Trees API (recursive) has no such cap.
    url = f"https://api.github.com/repos/{settings.github_repo}/git/trees/{settings.github_branch}?recursive=1"
    headers = {"Accept": "application/vnd.github+json"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, follow_redirects=True)
        response.raise_for_status()
        data = response.json()

    if data.get("truncated"):
        logging.warning("GitHub tree response was truncated - some images may be missing from sync")

    added = 0
    total = 0
    base = settings.image_cdn_base.rstrip("/") + "/"
    for item in data.get("tree", []):
        path = item["path"]
        if item["type"] != "blob" or not path.startswith("images/") or not path.lower().endswith(".png"):
            continue
        filename = path[len("images/"):]
        total += 1
        _, is_new = await upsert_image(db, filename, base + filename)
        if is_new:
            added += 1

    await db.commit()
    return {"added": added, "total": total}
