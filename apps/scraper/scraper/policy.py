"""Collection rules (spec, 6.10): who we may talk to, how fast, and how we introduce ourselves.

These are enforced in code, not left to each spider:
- robots.txt is obeyed (Scrapy setting, see `crawl.py`);
- 2 to 5 seconds between requests to a domain;
- an identifiable User-Agent;
- no authentication, no proxies, no anti-bot or CAPTCHA bypass;
- never LinkedIn, whatever the configuration says;
- only domains the client has validated (an allow-list: empty means nothing is allowed).
"""

from __future__ import annotations

from urllib.parse import urlsplit

MIN_DELAY_SECONDS = 2.0
MAX_DELAY_SECONDS = 5.0

# Never collected, even if someone adds them to the allow-list.
DENYLIST = ("linkedin.com", "licdn.com")

DEFAULT_USER_AGENT = (
    "MangaPerformanceBot/1.0 (+https://www.manga-performance.example/robot; "
    "professional directory collection, respects robots.txt)"
)

# Signs that a site is refusing us: we stop there instead of trying to get around it.
BLOCK_STATUS_CODES = (403, 429)
BLOCK_MARKERS = ("captcha", "are you a robot", "cf-challenge", "attention required")


class PolicyError(ValueError):
    """The configuration would break a collection rule."""


def normalise_domains(raw: str) -> tuple[str, ...]:
    """`"example.com, Annuaire.CI"` -> ("example.com", "annuaire.ci")."""
    return tuple(sorted({part.strip().lower().lstrip(".") for part in raw.split(",") if part.strip()}))


def _hostname(url: str) -> str | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https"):
        return None
    return (parts.hostname or "").lower().rstrip(".") or None


def _matches(host: str, domain: str) -> bool:
    """Exact host or a real subdomain: `evilexample.com` does not match `example.com`."""
    return host == domain or host.endswith("." + domain)


def is_denylisted(url: str) -> bool:
    host = _hostname(url)
    return host is not None and any(_matches(host, blocked) for blocked in DENYLIST)


def host_allowed(url: str, allowed_domains: tuple[str, ...]) -> bool:
    """True only for http(s) URLs on an allow-listed domain that is not on the deny-list."""
    host = _hostname(url)
    if host is None or is_denylisted(url):
        return False
    return any(_matches(host, domain) for domain in allowed_domains)


def validate_delay(delay: float, *, test_mode: bool = False) -> float:
    """The politeness delay must stay between 2 and 5 seconds (relaxed only in tests)."""
    if not test_mode and not (MIN_DELAY_SECONDS <= delay <= MAX_DELAY_SECONDS):
        raise PolicyError(
            f"SCRAPER_DOWNLOAD_DELAY must be between {MIN_DELAY_SECONDS:g} and {MAX_DELAY_SECONDS:g} seconds, got {delay:g}"
        )
    if delay < 0:
        raise PolicyError("SCRAPER_DOWNLOAD_DELAY cannot be negative")
    return delay


def looks_blocked(status: int, body_start: str) -> bool:
    lowered = body_start.lower()
    return status in BLOCK_STATUS_CODES or any(marker in lowered for marker in BLOCK_MARKERS)
