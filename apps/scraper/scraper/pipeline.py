"""Item pipeline: pushes collected companies to the web app in batches."""

from __future__ import annotations

from .client import ApiError, InternalApiClient, JobClosed

API_ERROR_STAT = "scraper/api_error"
ACCEPTED_STAT = "scraper/accepted"
DUPLICATES_STAT = "scraper/duplicates"
INVALID_STAT = "scraper/invalid"
LIMIT_STAT = "scraper/limit_reached"


class BatchPipeline:
    def __init__(self, client: InternalApiClient, job_id: str, batch_size: int, stats):
        self.client = client
        self.job_id = job_id
        self.batch_size = batch_size
        self.stats = stats
        self.buffer: list[dict] = []

    @classmethod
    def from_crawler(cls, crawler):
        settings = crawler.settings
        client = InternalApiClient(
            settings.get("SCRAPER_API_URL"), settings.get("SCRAPER_API_TOKEN"), settings.get("SCRAPER_API_SECRET")
        )
        return cls(client, settings.get("SCRAPER_JOB_ID"), settings.getint("SCRAPER_BATCH_SIZE", 50), crawler.stats)

    def process_item(self, item, spider=None):
        self.buffer.append(dict(item))
        if len(self.buffer) >= self.batch_size:
            self._flush()
        return item

    def close_spider(self, spider=None):
        self._flush()
        self.client.close()

    def _flush(self) -> None:
        if not self.buffer or self.stats.get_value(API_ERROR_STAT):
            self.buffer.clear()
            return
        batch, self.buffer = self.buffer, []
        try:
            outcome = self.client.push_results(self.job_id, batch)
        except JobClosed as error:
            self.stats.set_value(API_ERROR_STAT, f"job closed: {error}")
            return
        except ApiError as error:
            self.stats.set_value(API_ERROR_STAT, str(error))
            return
        self.stats.inc_value(ACCEPTED_STAT, outcome.get("accepted", 0))
        self.stats.inc_value(DUPLICATES_STAT, outcome.get("duplicates", 0))
        self.stats.inc_value(INVALID_STAT, outcome.get("invalid", 0))
        if outcome.get("limitReached"):
            self.stats.set_value(LIMIT_STAT, True)
