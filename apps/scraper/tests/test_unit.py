import json
from pathlib import Path

import httpx
import pytest

from scraper.client import ApiError, InternalApiClient, JobClosed
from scraper.config import Config
from scraper.policy import (
    PolicyError,
    host_allowed,
    is_denylisted,
    looks_blocked,
    normalise_domains,
    validate_delay,
)
from scraper.runner import process_one
from scraper.signing import sign, signed_headers

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "signing-vectors.json").read_text(encoding="utf-8"))
SECRET = "s" * 40


@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["name"])
def test_signing_matches_shared_vectors(vector):
    got = sign(
        vector["secret"],
        timestamp=vector["timestamp"],
        nonce=vector["nonce"],
        method=vector["method"],
        path=vector["path"],
        body=vector["body"].encode("utf-8"),
    )
    assert got == vector["signature"]


def test_signed_headers_have_fresh_nonce_each_time():
    a = signed_headers(token="t", secret=SECRET, method="GET", path="/x", now=1000)
    b = signed_headers(token="t", secret=SECRET, method="GET", path="/x", now=1000)
    assert a["X-Nonce"] != b["X-Nonce"]
    assert a["X-Signature"] != b["X-Signature"]


# ---- policy ------------------------------------------------------------------------------------


def test_allow_list_is_strict():
    allowed = normalise_domains("Example.com, .annuaire.ci")
    assert allowed == ("annuaire.ci", "example.com")
    assert host_allowed("https://www.example.com/a", allowed)
    assert host_allowed("http://example.com", allowed)
    assert not host_allowed("https://evilexample.com", allowed)
    assert not host_allowed("https://example.com.evil.net", allowed)
    assert not host_allowed("ftp://example.com", allowed)
    assert not host_allowed("https://example.com", ())


def test_linkedin_is_never_allowed_even_if_listed():
    allowed = normalise_domains("linkedin.com,example.com")
    assert is_denylisted("https://www.linkedin.com/company/x")
    assert not host_allowed("https://www.linkedin.com/company/x", allowed)


@pytest.mark.parametrize("delay", [0, 1.9, 5.1, 10])
def test_delay_outside_2_to_5_seconds_is_refused(delay):
    with pytest.raises(PolicyError):
        validate_delay(delay)


def test_delay_can_be_relaxed_only_in_test_mode():
    assert validate_delay(3.5) == 3.5
    assert validate_delay(0.05, test_mode=True) == 0.05
    with pytest.raises(PolicyError):
        validate_delay(-1, test_mode=True)


def test_block_detection():
    assert looks_blocked(403, "")
    assert looks_blocked(429, "")
    assert looks_blocked(200, "<html>Please solve this CAPTCHA</html>")
    assert not looks_blocked(200, "<html>Annuaire</html>")


def test_config_requires_secrets_and_valid_batch():
    with pytest.raises(PolicyError):
        Config.from_env({})
    base = {"INTERNAL_API_TOKEN": "t", "INTERNAL_API_HMAC_SECRET": "s"}
    assert Config.from_env(base).download_delay == 3.5
    with pytest.raises(PolicyError):
        Config.from_env({**base, "SCRAPER_BATCH_SIZE": "101"})
    with pytest.raises(PolicyError):
        Config.from_env({**base, "SCRAPER_DOWNLOAD_DELAY": "0.1"})


# ---- client ------------------------------------------------------------------------------------


def make_client(handler, **kwargs):
    return InternalApiClient(
        "http://web.test",
        "token",
        SECRET,
        transport=httpx.MockTransport(handler),
        clock=lambda: 1_794_042_000,
        sleep=lambda _s: None,
        **kwargs,
    )


def test_requests_are_signed_over_the_exact_body():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, json={"accepted": 1, "duplicates": 0, "invalid": 0, "limitReached": False})

    make_client(handler).push_results("job1", [{"companyName": "Société é"}])
    request = seen["request"]
    expected = sign(
        SECRET,
        timestamp=int(request.headers["x-timestamp"]),
        nonce=request.headers["x-nonce"],
        method="POST",
        path="/api/internal/scrape-jobs/job1/results",
        body=request.content,
    )
    assert request.headers["x-signature"] == expected
    assert request.headers["x-internal-token"] == "token"
    assert json.loads(request.content) == {"results": [{"companyName": "Société é"}]}


def test_next_job_none_on_204_and_job_otherwise():
    assert make_client(lambda r: httpx.Response(204)).next_job() is None
    job = {"id": "j", "source": "annuaire", "filters": {}}
    assert make_client(lambda r: httpx.Response(200, json={"job": job})).next_job() == job


def test_transient_failures_are_retried_with_a_new_nonce():
    nonces = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonces.append(request.headers["x-nonce"])
        return httpx.Response(503) if len(nonces) < 3 else httpx.Response(204)

    assert make_client(handler).next_job() is None
    assert len(nonces) == 3 and len(set(nonces)) == 3


def test_gives_up_after_the_retries():
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ConnectError("down")

    with pytest.raises(ApiError):
        make_client(handler, retries=2).next_job()
    assert len(calls) == 3


def test_client_errors_are_not_retried():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(401, json={"error": "UNAUTHORIZED"})

    with pytest.raises(ApiError) as caught:
        make_client(handler).next_job()
    assert caught.value.status == 401 and len(calls) == 1


def test_409_means_job_closed():
    with pytest.raises(JobClosed):
        make_client(lambda r: httpx.Response(409, json={"error": "CONFLICT"})).push_results("j", [])


# ---- runner ------------------------------------------------------------------------------------


def runner_config():
    return Config.from_env({"INTERNAL_API_TOKEN": "t", "INTERNAL_API_HMAC_SECRET": "s"})


def api_recording(job):
    finished = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"job": job}) if job else httpx.Response(204)
        finished.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "j", "status": finished[-1]["status"], "resultsCount": 0})

    return handler, finished


def test_runner_idle_when_queue_is_empty():
    handler, finished = api_recording(None)
    assert process_one(make_client(handler), runner_config(), lambda c, j: {"ok": True}) is False
    assert finished == []


def test_runner_closes_job_done_or_failed():
    job = {"id": "j", "source": "annuaire", "filters": {}}
    handler, finished = api_recording(job)
    assert process_one(make_client(handler), runner_config(), lambda c, j: {"ok": True}) is True
    assert finished[-1] == {"status": "DONE"}
    process_one(make_client(handler), runner_config(), lambda c, j: {"ok": False, "error": "blocked"})
    assert finished[-1] == {"status": "FAILED", "error": "blocked"}


def test_runner_fails_the_job_when_the_crawl_crashes():
    job = {"id": "j", "source": "annuaire", "filters": {}}
    handler, finished = api_recording(job)

    def boom(config, job):
        raise RuntimeError("secret detail must not leak")

    process_one(make_client(handler), runner_config(), boom)
    assert finished[-1]["status"] == "FAILED"
    assert "secret detail" not in finished[-1]["error"]
