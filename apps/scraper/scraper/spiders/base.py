from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import scrapy

from ..pipeline import API_ERROR_STAT, LIMIT_STAT


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Source(scrapy.Spider):
    """Common interface of every source (spec, 6.10): one spider per source in `spiders/`.

    A spider only extracts: politeness, robots.txt, domain checks and delivery to the web app are
    handled by the framework around it. It yields dicts with the fields of the internal API:
    `companyName` (required), `sector`, `city`, `address`, `phone`, `email`, `sourceUrl`, `collectedAt`.
    """

    #: Name of the job source this spider serves (`annuaire`, `appels_offres`, `site_web`).
    source: str = ""

    def __init__(self, filters: dict[str, Any] | None = None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.filters = filters or {}

    def should_stop(self) -> bool:
        """True once delivery to the web app failed or its ceiling was reached: more pages are useless."""
        stats = self.crawler.stats
        return bool(stats.get_value(API_ERROR_STAT) or stats.get_value(LIMIT_STAT))

    def matches_filters(self, company: dict[str, Any]) -> bool:
        """Case-insensitive 'contains' on the sector and city filters the admin chose."""
        for key in ("sector", "city"):
            wanted = (self.filters.get(key) or "").strip().lower()
            if wanted and wanted not in (company.get(key) or "").lower():
                return False
        return True

    def company(self, response, **fields: Any) -> dict[str, Any]:
        """A result with the provenance fields filled in."""
        return {**{k: v for k, v in fields.items() if v}, "sourceUrl": response.url, "collectedAt": now_iso()}
