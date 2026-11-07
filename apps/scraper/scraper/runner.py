"""Polling loop: claim a queued job, crawl it in a child process, close it."""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
from typing import Any, Callable

from .client import ApiError, InternalApiClient
from .config import Config

log = logging.getLogger("scraper.runner")

CrawlFn = Callable[[Config, dict[str, Any]], dict[str, Any]]


def crawl_in_subprocess(config: Config, job: dict[str, Any]) -> dict[str, Any]:
    """One process per job: Twisted's reactor can only run once per process."""
    try:
        done = subprocess.run(
            [sys.executable, "-m", "scraper.crawl"],
            input=json.dumps({"job": job}),
            capture_output=True,
            text=True,
            timeout=config.job_timeout_seconds + 120,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Délai maximal de collecte dépassé."}
    lines = [line for line in done.stdout.splitlines() if line.strip()]
    try:
        return json.loads(lines[-1])
    except (IndexError, ValueError):
        log.error("crawl process produced no outcome (exit %s)", done.returncode)
        return {"ok": False, "error": "Le service de collecte a rencontré une erreur interne."}


def process_one(client: InternalApiClient, config: Config, crawl: CrawlFn = crawl_in_subprocess) -> bool:
    """Handles the next queued job. Returns False when the queue is empty."""
    job = client.next_job()
    if job is None:
        return False
    log.info("job %s claimed (source %s)", job["id"], job["source"])
    try:
        outcome = crawl(config, job)
    except Exception as error:  # a crash must close the job, not leave it RUNNING
        log.exception("crawl crashed")
        outcome = {"ok": False, "error": f"Erreur interne : {type(error).__name__}"}
    try:
        client.finish(job["id"], "DONE" if outcome.get("ok") else "FAILED", outcome.get("error"))
    except ApiError as error:
        log.error("could not close job %s: %s", job["id"], error)
    return True


def run_forever(config: Config, client: InternalApiClient, *, once: bool = False, sleep: Callable[[float], None] = time.sleep) -> None:
    while True:
        try:
            worked = process_one(client, config)
        except ApiError as error:
            log.error("API unavailable: %s", error)
            worked = False
        if once and not worked:
            return
        if not worked:
            sleep(config.poll_seconds)


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = argv if argv is not None else sys.argv[1:]
    config = Config.from_env()
    client = InternalApiClient(config.api_url, config.api_token, config.api_secret)
    run_forever(config, client, once="--once" in args)
