"""End to end: the real crawler against a local fixture site and a fake signed API."""

import json
import os
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from scraper.policy import DEFAULT_USER_AGENT
from scraper.signing import sign

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "fixtures" / "site"
TOKEN = "t" * 32
SECRET = "s" * 40


class SiteHandler(SimpleHTTPRequestHandler):
    hits: list[tuple[str, float, str]] = []

    def do_GET(self):
        SiteHandler.hits.append((self.path, time.monotonic(), self.headers.get("User-Agent", "")))
        super().do_GET()

    def log_message(self, *args):
        pass


def serve(handler_cls):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class FakeApi(BaseHTTPRequestHandler):
    received: list[dict] = []
    finished: list[dict] = []
    refused = 0

    def log_message(self, *args):
        pass

    def _verified(self, body: bytes) -> bool:
        h = self.headers
        expected = sign(
            SECRET,
            timestamp=int(h.get("X-Timestamp", "0")),
            nonce=h.get("X-Nonce", ""),
            method=self.command,
            path=self.path,
            body=body,
        )
        ok = h.get("X-Internal-Token") == TOKEN and h.get("X-Signature") == expected
        if not ok:
            FakeApi.refused += 1
            self.send_response(401)
            self.end_headers()
        return ok

    def _json(self, payload):
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if not self._verified(body):
            return
        results = json.loads(body)["results"]
        FakeApi.received.extend(results)
        self._json({"accepted": len(results), "duplicates": 0, "invalid": 0, "limitReached": False})


def run_crawl(site_port: int, api_port: int, *, domains: str, extra_env=None, job_filters=None):
    env = {
        **os.environ,
        "INTERNAL_API_URL": f"http://127.0.0.1:{api_port}",
        "INTERNAL_API_TOKEN": TOKEN,
        "INTERNAL_API_HMAC_SECRET": SECRET,
        "SCRAPER_ALLOWED_DOMAINS": domains,
        "SCRAPER_DOWNLOAD_DELAY": "0.3",
        "SCRAPER_TEST_MODE": "1",
        "SCRAPER_DEMO_URL": f"http://127.0.0.1:{site_port}/directory/index.html",
        **(extra_env or {}),
    }
    job = {"id": "job1", "source": "annuaire", "filters": job_filters or {}}
    done = subprocess.run(
        [sys.executable, "-m", "scraper.crawl"],
        input=json.dumps({"job": job}),
        capture_output=True,
        text=True,
        env=env,
        cwd=ROOT,
        timeout=120,
    )
    lines = [line for line in done.stdout.splitlines() if line.strip()]
    assert lines, done.stderr[-2000:]
    return json.loads(lines[-1])


@pytest.fixture()
def world():
    SiteHandler.hits = []
    FakeApi.received, FakeApi.finished, FakeApi.refused = [], [], 0
    site = serve(partial(SiteHandler, directory=str(SITE)))
    api = serve(FakeApi)
    yield site.server_address[1], api.server_address[1]
    site.shutdown()
    api.shutdown()


def test_collects_politely_and_respects_robots_txt(world):
    site_port, api_port = world
    outcome = run_crawl(site_port, api_port, domains="127.0.0.1")

    assert outcome["ok"] is True, outcome
    names = sorted(r["companyName"] for r in FakeApi.received)
    assert names == ["Boulangerie Akissi", "Pharmacie Tano", "Societe Lagune SARL", "Société Lagune", "Transports Soro"]
    assert FakeApi.refused == 0

    paths = [p for p, _, _ in SiteHandler.hits]
    assert "/robots.txt" in paths
    assert not any("/private/" in p for p in paths), "robots.txt must keep the crawler out of /private/"
    assert all(ua == DEFAULT_USER_AGENT for _, _, ua in SiteHandler.hits)

    # Politeness: consecutive page requests are separated by the configured delay.
    pages = [t for p, t, _ in SiteHandler.hits if p.startswith("/directory/")]
    gaps = [b - a for a, b in zip(pages, pages[1:])]
    assert gaps and min(gaps) >= 0.25

    sample = next(r for r in FakeApi.received if r["companyName"] == "Société Lagune")
    assert sample["phone"] == "+225 07 01 02 03 04"
    assert sample["email"] == "contact@lagune.example"
    assert sample["sourceUrl"].endswith("/directory/index.html")
    assert sample["collectedAt"].endswith("Z")


def test_filters_narrow_the_results(world):
    site_port, api_port = world
    outcome = run_crawl(site_port, api_port, domains="127.0.0.1", job_filters={"sector": "btp"})
    assert outcome["ok"] is True
    assert sorted(r["companyName"] for r in FakeApi.received) == ["Societe Lagune SARL", "Société Lagune"]


def test_nothing_is_fetched_outside_the_allow_list(world):
    site_port, api_port = world
    outcome = run_crawl(site_port, api_port, domains="example.org")
    assert FakeApi.received == []
    assert SiteHandler.hits == []
    assert outcome["accepted"] == 0


def test_unsigned_batches_are_refused_and_fail_the_job(world):
    site_port, api_port = world
    outcome = run_crawl(site_port, api_port, domains="127.0.0.1", extra_env={"INTERNAL_API_HMAC_SECRET": "x" * 40})
    assert outcome["ok"] is False
    assert FakeApi.received == []
    assert FakeApi.refused >= 1
