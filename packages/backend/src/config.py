"""Backend configuration."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""
    
    # API settings
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_reload: bool = False
    
    # CORS settings
    cors_origins: list[str] = ["http://localhost:3000"]
    
    # Anthropic API
    anthropic_api_key: str | None = None
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Global settings instance
settings = Settings()
