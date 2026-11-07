"""Request signing for the internal API. Must match `packages/core/src/internal-api.ts`.

Signed string: `{timestamp}.{nonce}.{METHOD}.{path?query}.{sha256 hex of the body}`,
HMAC-SHA256 with the shared secret. Both sides are tested against
`tests/fixtures/signing-vectors.json`.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time


def body_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def sign(secret: str, *, timestamp: int, nonce: str, method: str, path: str, body: bytes = b"") -> str:
    message = ".".join([str(timestamp), nonce, method.upper(), path, body_hash(body)])
    return hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def signed_headers(
    *, token: str, secret: str, method: str, path: str, body: bytes = b"", now: float | None = None, nonce: str | None = None
) -> dict[str, str]:
    """Headers for one request: shared token, timestamp, a fresh nonce and the signature."""
    timestamp = int(time.time() if now is None else now)
    nonce = nonce or secrets.token_hex(8)
    return {
        "X-Internal-Token": token,
        "X-Timestamp": str(timestamp),
        "X-Nonce": nonce,
        "X-Signature": sign(secret, timestamp=timestamp, nonce=nonce, method=method, path=path, body=body),
    }
