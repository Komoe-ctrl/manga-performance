from __future__ import annotations

import os

import scrapy

from .base import Source


class DemoDirectorySpider(Source):
    """Demonstration spider on a local test directory (`fixtures/site/directory`).

    Real sources are added one at a time, after the client has validated them (spec, 6.10, 14).
    The start URL comes from `SCRAPER_DEMO_URL`.
    """

    name = "annuaire_demo"
    source = "annuaire"

    async def start(self):
        url = self.settings.get("SCRAPER_DEMO_URL") or os.environ.get("SCRAPER_DEMO_URL", "")
        if url:
            yield scrapy.Request(url, callback=self.parse)

    def parse(self, response):
        if self.should_stop():
            return
        for card in response.css("article.company"):
            phone = card.css("a.phone::attr(href)").get("")
            email = card.css("a.email::attr(href)").get("")
            company = {
                "companyName": " ".join(card.css("h2 ::text").getall()).strip(),
                "sector": (card.css(".sector::text").get() or "").strip(),
                "city": (card.css(".city::text").get() or "").strip(),
                "address": (card.css(".address::text").get() or "").strip(),
                "phone": phone.removeprefix("tel:").strip(),
                "email": email.removeprefix("mailto:").strip(),
            }
            if company["companyName"] and self.matches_filters(company):
                yield self.company(response, **company)

        next_page = response.css("a[rel=next]::attr(href)").get()
        if next_page:
            yield response.follow(next_page, callback=self.parse)
        # The page also links to a private section that robots.txt disallows: it must never be fetched.
        hidden = response.css("a.members-only::attr(href)").get()
        if hidden:
            yield response.follow(hidden, callback=self.parse_private)

    def parse_private(self, response):  # pragma: no cover - robots.txt keeps us out; kept to prove it
        yield self.company(response, companyName="SHOULD NEVER BE COLLECTED")
