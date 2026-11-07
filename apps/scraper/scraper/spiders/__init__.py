"""Spiders, one per source. The registry maps a job's `source` to its spider."""

from __future__ import annotations

from .base import Source
from .demo_directory import DemoDirectorySpider

# Only the demonstration spider exists for now; real sources are added after the client validates them.
SOURCES: dict[str, type[Source]] = {
    DemoDirectorySpider.source: DemoDirectorySpider,
}

__all__ = ["SOURCES", "Source", "DemoDirectorySpider"]
