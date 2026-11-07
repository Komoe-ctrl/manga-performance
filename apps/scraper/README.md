# Scraper service

Polite collection service for MANGA PERFORMANCE. It never touches the database: it claims jobs from the web app
and pushes results through the signed internal API.

## Run

```bash
cd apps/scraper
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"      # Linux/macOS: .venv/bin/pip

# required: INTERNAL_API_TOKEN, INTERNAL_API_HMAC_SECRET (same values as the web app)
# optional: see "Configuration"
python -m scraper          # polls forever
python -m scraper --once   # drains the queue, then exits
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `INTERNAL_API_URL` | `http://localhost:3000` | Web app base URL (Docker network address in production) |
| `INTERNAL_API_TOKEN`, `INTERNAL_API_HMAC_SECRET` | required | Shared with the web app |
| `SCRAPER_ALLOWED_DOMAINS` | empty | Comma-separated allow-list. Empty means nothing may be collected |
| `SCRAPER_DOWNLOAD_DELAY` | `3.5` | Seconds between requests; refused outside 2-5 |
| `SCRAPER_USER_AGENT` | `MangaPerformanceBot/1.0 (...)` | Must identify the bot and a contact page |
| `SCRAPER_BATCH_SIZE` | `50` | 1-100 |
| `SCRAPER_MAX_PAGES` / `SCRAPER_JOB_TIMEOUT_SECONDS` | `200` / `3600` | Per-job ceilings |
| `SCRAPER_POLL_SECONDS` | `30` | Idle polling interval |

## Compliance rules (enforced in code, `scraper/policy.py` and `scraper/middleware.py`)

- robots.txt is obeyed; 2-5 s between requests, one at a time per domain; identifiable User-Agent.
- Only allow-listed domains, also across redirects. LinkedIn is always refused.
- No authentication, proxy, CAPTCHA or anti-bot workaround. On 403/429/CAPTCHA the host is dropped and the job
  fails with an explicit message.
- Each source is a spider in `scraper/spiders/`, registered in `SOURCES`. Only a demonstration spider ships;
  real sources are added one at a time after the client validates them.

## Tests

`python -m pytest`: signing vectors shared with the TypeScript side, policy, client (retries, replay-safe),
runner, and an end-to-end crawl against `fixtures/site` plus a fake signed API (robots.txt, User-Agent, delay,
allow-list).

In production, Caddy must restrict `/api/internal/*` to the Docker network.
