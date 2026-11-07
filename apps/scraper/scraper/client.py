from __future__ import annotations

import json
import time
from typing import Any, Callable

import httpx

from .signing import signed_headers

JOBS_PATH = "/api/internal/scrape-jobs"


class ApiError(RuntimeError):
    """The web app refused or failed a request (message never contains secrets)."""

    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status


class JobClosed(ApiError):
    """The job no longer accepts results (closed, or never running): stop collecting."""


class InternalApiClient:
    """Signed client for the internal API (spec, 6.10). Retries only transient failures."""

    def __init__(
        self,
        base_url: str,
        token: str,
        secret: str,
        *,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
        retries: int = 3,
    ):
        self._token = token
        self._secret = secret
        self._clock = clock
        self._sleep = sleep
        self._retries = retries
        self._http = httpx.Client(base_url=base_url, transport=transport, timeout=30.0, follow_redirects=False)

    def close(self) -> None:
        self._http.close()

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> httpx.Response:
        # The signature covers these exact bytes, so they are what gets sent.
        body = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        for attempt in range(self._retries + 1):
            # A fresh nonce and timestamp for each attempt: a retry is never a replay.
            headers = signed_headers(
                token=self._token, secret=self._secret, method=method, path=path, body=body, now=self._clock()
            )
            if body:
                headers["Content-Type"] = "application/json"
            try:
                response = self._http.request(method, path, content=body or None, headers=headers)
            except httpx.TransportError as error:
                if attempt == self._retries:
                    raise ApiError(0, f"network error: {type(error).__name__}") from error
                self._sleep(min(2**attempt, 10))
                continue
            if response.status_code >= 500 and attempt < self._retries:
                self._sleep(min(2**attempt, 10))
                continue
            return response
        raise AssertionError("unreachable")

    @staticmethod
    def _check(response: httpx.Response) -> None:
        if response.is_success:
            return
        try:
            code = response.json().get("error", "")
        except ValueError:
            code = ""
        if response.status_code == 409:
            raise JobClosed(409, code or "CONFLICT")
        raise ApiError(response.status_code, code or "request failed")

    def next_job(self) -> dict[str, Any] | None:
        """The next queued job (now RUNNING), or None when there is nothing to do."""
        response = self._request("GET", f"{JOBS_PATH}/next")
        if response.status_code == 204:
            return None
        self._check(response)
        return response.json()["job"]

    def push_results(self, job_id: str, results: list[dict[str, Any]]) -> dict[str, Any]:
        response = self._request("POST", f"{JOBS_PATH}/{job_id}/results", {"results": results})
        self._check(response)
        return response.json()

    def finish(self, job_id: str, status: str, error: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"status": status}
        if error:
            payload["error"] = error[:450]
        response = self._request("PATCH", f"{JOBS_PATH}/{job_id}", payload)
        self._check(response)
        return response.json()
