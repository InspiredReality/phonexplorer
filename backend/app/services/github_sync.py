import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.services.sticker_crud import upsert_image


async def sync_images_from_github(db: AsyncSession) -> dict:
    url = f"https://api.github.com/repos/{settings.github_repo}/contents/images?ref={settings.github_branch}"
    headers = {"Accept": "application/vnd.github+json"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, follow_redirects=True)
        response.raise_for_status()
        contents = response.json()

    added = 0
    total = 0
    base = settings.jsdelivr_base.rstrip("/") + "/"
    for item in contents:
        if item["type"] != "file" or not item["name"].lower().endswith(".png"):
            continue
        total += 1
        _, is_new = await upsert_image(db, item["name"], base + item["name"])
        if is_new:
            added += 1

    await db.commit()
    return {"added": added, "total": total}
