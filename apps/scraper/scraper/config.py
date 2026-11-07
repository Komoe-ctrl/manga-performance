from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping

from .policy import DEFAULT_USER_AGENT, PolicyError, normalise_domains, validate_delay


@dataclass(frozen=True)
class Config:
    api_url: str
    api_token: str
    api_secret: str
    allowed_domains: tuple[str, ...] = ()
    user_agent: str = DEFAULT_USER_AGENT
    download_delay: float = 3.5
    batch_size: int = 50
    max_pages: int = 200
    poll_seconds: float = 30.0
    job_timeout_seconds: float = 3600.0
    demo_url: str = ""
    test_mode: bool = field(default=False, repr=False)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Config":
        env = os.environ if env is None else env
        missing = [name for name in ("INTERNAL_API_TOKEN", "INTERNAL_API_HMAC_SECRET") if not env.get(name)]
        if missing:
            raise PolicyError(f"Missing environment variables: {', '.join(missing)}")

        test_mode = env.get("SCRAPER_TEST_MODE") == "1"
        batch_size = int(env.get("SCRAPER_BATCH_SIZE", "50"))
        if not 1 <= batch_size <= 100:
            raise PolicyError("SCRAPER_BATCH_SIZE must be between 1 and 100 (the API refuses larger batches)")

        return cls(
            api_url=env.get("INTERNAL_API_URL", "http://localhost:3000").rstrip("/"),
            api_token=env["INTERNAL_API_TOKEN"],
            api_secret=env["INTERNAL_API_HMAC_SECRET"],
            allowed_domains=normalise_domains(env.get("SCRAPER_ALLOWED_DOMAINS", "")),
            user_agent=env.get("SCRAPER_USER_AGENT", DEFAULT_USER_AGENT),
            download_delay=validate_delay(float(env.get("SCRAPER_DOWNLOAD_DELAY", "3.5")), test_mode=test_mode),
            batch_size=batch_size,
            max_pages=int(env.get("SCRAPER_MAX_PAGES", "200")),
            poll_seconds=float(env.get("SCRAPER_POLL_SECONDS", "30")),
            job_timeout_seconds=float(env.get("SCRAPER_JOB_TIMEOUT_SECONDS", "3600")),
            demo_url=env.get("SCRAPER_DEMO_URL", ""),
            test_mode=test_mode,
        )
