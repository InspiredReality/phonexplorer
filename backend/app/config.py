from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    port: int = 8000

    # Comma-separated string in env vars (e.g. Railway / Vercel dashboards)
    # e.g. ALLOWED_ORIGINS=http://localhost:3000,https://yourapp.vercel.app
    allowed_origins_raw: str = "http://localhost:3000"

    # Accepts both DATABASE_URL (Railway default) and DATABASE_URL_RAW
    database_url_raw: str = Field(
        default="postgresql+asyncpg://localhost/phonexplorer",
        validation_alias=AliasChoices("DATABASE_URL_RAW", "DATABASE_URL"),
    )

    # Sticker API
    admin_token: str = ""
    github_repo: str = "InspiredReality/inspiredrealityservice"
    github_branch: str = "main"
    github_token: str = ""
    jsdelivr_base: str = "https://cdn.jsdelivr.net/gh/InspiredReality/inspiredrealityservice@main/images/"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]

    @property
    def database_url(self) -> str:
        url = self.database_url_raw
        if url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]
        return url


settings = Settings()
