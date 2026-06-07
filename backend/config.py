from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    port: int = 8000

    # Comma-separated string in env vars (e.g. Railway / Vercel dashboards)
    # e.g. ALLOWED_ORIGINS=http://localhost:3000,https://yourapp.vercel.app
    allowed_origins_raw: str = "http://localhost:3000"

    # Railway injects DATABASE_URL as postgres:// — asyncpg needs postgresql+asyncpg://
    database_url_raw: str = "postgresql+asyncpg://localhost/phonexplorer"

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
