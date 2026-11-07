"""Scrapy downloader middleware enforcing the collection policy on every request."""

from __future__ import annotations

from urllib.parse import urlsplit

from scrapy.exceptions import IgnoreRequest

from .policy import host_allowed, looks_blocked

BLOCKED_STAT = "scraper/blocked_by_site"
REFUSED_STAT = "scraper/refused_by_policy"


class PolicyDownloaderMiddleware:
    """Refuses hosts outside the allow-list (also on redirects) and stops at the first sign of blocking.

    When a site answers 403/429 or shows a CAPTCHA, we do not retry or work around it: the host is
    marked blocked, every further request to it is dropped, and the job ends as failed.
    """

    def __init__(self, allowed_domains: tuple[str, ...], stats):
        self.allowed_domains = allowed_domains
        self.stats = stats
        self.blocked_hosts: set[str] = set()

    @classmethod
    def from_crawler(cls, crawler):
        allowed = tuple(crawler.settings.getlist("SCRAPER_ALLOWED_DOMAINS"))
        return cls(allowed, crawler.stats)

    def process_request(self, request, spider=None):
        host = urlsplit(request.url).hostname or ""
        if not host_allowed(request.url, self.allowed_domains) or host in self.blocked_hosts:
            self.stats.inc_value(REFUSED_STAT)
            raise IgnoreRequest(f"outside the collection policy: {host or request.url}")
        return None

    def process_response(self, request, response, spider=None):
        host = urlsplit(request.url).hostname or ""
        # robots.txt itself may legitimately be a 403/404; only judge real pages.
        if not request.url.endswith("/robots.txt"):
            body_start = response.text[:20000] if hasattr(response, "text") else ""
            if looks_blocked(response.status, body_start):
                self.blocked_hosts.add(host)
                self.stats.set_value(BLOCKED_STAT, host)
                raise IgnoreRequest(f"blocked by {host} (status {response.status}): not retrying")
        return response
