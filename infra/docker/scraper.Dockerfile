# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f infra/docker/scraper.Dockerfile -t manga-scraper .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY apps/scraper/pyproject.toml ./
COPY apps/scraper/scraper ./scraper
RUN pip install . && useradd --system --no-create-home scraper
USER scraper
# INTERNAL_API_URL points at the web container on the private network, never at the Internet.
CMD ["python", "-m", "scraper"]
