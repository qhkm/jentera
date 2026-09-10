"""Prove Hermes has a usable live search backend without invoking the model.

Extraction is proved here too, and it has to be. Until 2026-09-10 this file
exercised search alone, so a sprite could checkpoint green with an extraction
path nobody had run — and one did: every static check an operator can make
(the plugin registers, `supports_extract()` is true, `extract_backend` reads
`firecrawl`) passes without the SDK being present, because the provider
installs it lazily on first use. What that hid was not a broken backend but an
11 s install charged to an owner's first research question.

Search is unconditional. Extraction runs only where an endpoint is configured,
which is the same condition that selects the backend and pins the SDK: if
Jentera has told the sprite to extract with Firecrawl, the sprite proves here
that it can, at bootstrap, where the time is ours. Where it has not, ddgs
search alone is the documented fallback and there is nothing to prove.
"""

from __future__ import annotations

import asyncio
import json
import os

from plugins.web.ddgs.provider import DDGSWebSearchProvider

# Small, stable, and owned by nobody we would rather not hammer at every
# bootstrap. Its body is a known handful of sentences, so "we got real text
# back" is a check rather than a hope.
EXTRACT_PROBE_URL = "https://example.com"
EXTRACT_MIN_CHARS = 50


def check_search() -> str:
    provider = DDGSWebSearchProvider()
    if not provider.is_available():
        raise SystemExit("DDGS provider is unavailable")

    result = provider.search("Malaysia business news", limit=2)
    web = result.get("data", {}).get("web", []) if result.get("success") else []
    valid = [
        item
        for item in web
        if isinstance(item, dict)
        and isinstance(item.get("title"), str)
        and isinstance(item.get("url"), str)
        and item["url"].startswith(("https://", "http://"))
    ]
    if not valid:
        raise SystemExit("DDGS returned no checkable search results")
    return provider.name


def check_extract() -> int:
    """Extract one page through the real provider. Returns characters read."""
    # Imported here, not at module scope: without an endpoint the SDK is not
    # installed, and an unconditional import would fail the search smoke too.
    from plugins.web.firecrawl.provider import FirecrawlWebSearchProvider

    provider = FirecrawlWebSearchProvider()
    if not provider.is_available():
        raise SystemExit("Firecrawl provider is configured but reports unavailable")
    if not provider.supports_extract():
        raise SystemExit("Firecrawl provider does not support extract")

    results = asyncio.run(provider.extract([EXTRACT_PROBE_URL]))
    if not results:
        raise SystemExit(f"Firecrawl returned nothing for {EXTRACT_PROBE_URL}")

    first = results[0] if isinstance(results[0], dict) else {}
    text = ""
    for key in ("content", "text", "markdown", "raw_content"):
        value = first.get(key)
        if isinstance(value, str) and value.strip():
            text = value
            break
    if len(text) < EXTRACT_MIN_CHARS:
        raise SystemExit(
            f"Firecrawl extracted {len(text)} characters from "
            f"{EXTRACT_PROBE_URL}; expected at least {EXTRACT_MIN_CHARS}"
        )
    return len(text)


def main() -> None:
    report = {"ok": True, "backend": check_search()}

    configured = bool(os.environ.get("FIRECRAWL_API_URL")) and bool(
        os.environ.get("FIRECRAWL_API_KEY")
    )
    if configured:
        report["extract_backend"] = "firecrawl"
        report["extract_chars"] = check_extract()
    else:
        report["extract_backend"] = None

    print(json.dumps(report))


if __name__ == "__main__":
    main()
