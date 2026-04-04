from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    port: int = 8000

    # Comma-separated string in env vars (e.g. Railway / Vercel dashboards)
    # e.g. ALLOWED_ORIGINS=http://localhost:3000,https://yourapp.vercel.app
    allowed_origins_raw: str = "http://localhost:3000"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]


settings = Settings()
