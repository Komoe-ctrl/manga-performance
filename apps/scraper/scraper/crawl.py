"""Runs one Scrapy crawl for one job. Executed in its own process (Twisted's reactor cannot restart)."""

from __future__ import annotations

import json
import sys
from typing import Any

from scrapy.crawler import CrawlerProcess

from .config import Config
from .middleware import BLOCKED_STAT, REFUSED_STAT
from .pipeline import ACCEPTED_STAT, API_ERROR_STAT, DUPLICATES_STAT, INVALID_STAT, LIMIT_STAT
from .spiders import SOURCES


def build_settings(config: Config, job_id: str) -> dict[str, Any]:
    """Scrapy settings: the collection rules of `policy.py`, applied to every request."""
    return {
        "BOT_NAME": "manga-performance-bot",
        "USER_AGENT": config.user_agent,
        "ROBOTSTXT_OBEY": True,
        "DOWNLOAD_DELAY": config.download_delay,
        # A random factor would shrink the delay below the 2 s floor.
        "RANDOMIZE_DOWNLOAD_DELAY": False,
        "CONCURRENT_REQUESTS": 1,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 1,
        "AUTOTHROTTLE_ENABLED": False,
        "COOKIES_ENABLED": False,
        "RETRY_ENABLED": True,
        "RETRY_TIMES": 1,
        "RETRY_HTTP_CODES": [500, 502, 503, 504],
        "REDIRECT_MAX_TIMES": 3,
        "HTTPCACHE_ENABLED": False,
        "DOWNLOAD_TIMEOUT": 30,
        "CLOSESPIDER_PAGECOUNT": config.max_pages,
        "CLOSESPIDER_TIMEOUT": config.job_timeout_seconds,
        "LOG_LEVEL": "INFO",
        "TELNETCONSOLE_ENABLED": False,
        "MEMUSAGE_ENABLED": False,
        # Above Retry (550) and Redirect (600) so it judges the raw response first.
        "DOWNLOADER_MIDDLEWARES": {"scraper.middleware.PolicyDownloaderMiddleware": 610},
        "ITEM_PIPELINES": {"scraper.pipeline.BatchPipeline": 300},
        "SCRAPER_ALLOWED_DOMAINS": list(config.allowed_domains),
        "SCRAPER_API_URL": config.api_url,
        "SCRAPER_API_TOKEN": config.api_token,
        "SCRAPER_API_SECRET": config.api_secret,
        "SCRAPER_JOB_ID": job_id,
        "SCRAPER_BATCH_SIZE": config.batch_size,
        "SCRAPER_DEMO_URL": config.demo_url,
    }


def run_crawl(config: Config, job: dict[str, Any]) -> dict[str, Any]:
    """Returns `{"ok": bool, "error": str | None, "accepted": int, ...}`."""
    spider_cls = SOURCES.get(job["source"])
    if spider_cls is None:
        return {"ok": False, "error": f"Source non prise en charge : {job['source']}", "accepted": 0}

    process = CrawlerProcess(build_settings(config, job["id"]))
    crawler = process.create_crawler(spider_cls)
    process.crawl(crawler, filters=job.get("filters") or {})
    process.start()

    stats = crawler.stats
    blocked = stats.get_value(BLOCKED_STAT)
    api_error = stats.get_value(API_ERROR_STAT)
    error: str | None = None
    if blocked:
        error = f"Le site {blocked} refuse la collecte (blocage détecté) : arrêt sans contournement."
    elif api_error:
        error = f"Échec de l'envoi des résultats : {api_error}"
    elif stats.get_value("finish_reason") not in ("finished", None) and not stats.get_value(LIMIT_STAT):
        reason = stats.get_value("finish_reason")
        if reason in ("closespider_timeout",):
            error = "Délai maximal de collecte dépassé."
    return {
        "ok": error is None,
        "error": error,
        "accepted": stats.get_value(ACCEPTED_STAT, 0),
        "duplicates": stats.get_value(DUPLICATES_STAT, 0),
        "invalid": stats.get_value(INVALID_STAT, 0),
        "refused": stats.get_value(REFUSED_STAT, 0),
        "requests": stats.get_value("downloader/request_count", 0),
    }


def main() -> None:
    """`python -m scraper.crawl`: reads `{"job": {...}}` on stdin, prints the outcome as the last line."""
    payload = json.loads(sys.stdin.read())
    outcome = run_crawl(Config.from_env(), payload["job"])
    sys.stdout.write("\n" + json.dumps(outcome) + "\n")


if __name__ == "__main__":
    main()
