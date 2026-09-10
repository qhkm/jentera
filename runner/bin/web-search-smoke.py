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


def assert_points_at_our_instance() -> str:
    """Fail unless the client is aimed at the endpoint we configured.

    "We got text back" is not the same claim as "we got it from our own
    instance". The plugin builds a working client when either variable is
    present and only passes `api_url` when the URL is non-empty, so a lost
    FIRECRAWL_API_URL does not break extraction — it moves it to Firecrawl's
    cloud, along with this bearer token and every URL we read. That failure
    is invisible to a smoke that only counts characters.
    """
    expected = (os.environ.get("FIRECRAWL_API_URL") or "").strip().rstrip("/")
    if not expected:
        raise SystemExit("FIRECRAWL_API_URL is not set; refusing to extract")

    from plugins.web.firecrawl.provider import _get_direct_firecrawl_config

    resolved = _get_direct_firecrawl_config()
    if not resolved:
        raise SystemExit("Firecrawl reports no direct configuration")
    kwargs = resolved[0] if isinstance(resolved, tuple) else resolved
    actual = str((kwargs or {}).get("api_url") or "").strip().rstrip("/")
    if actual != expected:
        raise SystemExit(
            f"Firecrawl would call {actual or 'its hosted cloud'}, "
            f"not the configured {expected}"
        )
    # Belt and braces: the check above only proves the client matches what we
    # asked for. If what we asked for is somebody's hosted API, our pages and
    # this token leave our infrastructure whether or not the two agree.
    for hosted in ("api.firecrawl.dev", "firecrawl.dev"):
        if hosted in actual:
            raise SystemExit(f"refusing hosted Firecrawl at {actual}")
    return expected


def check_extract() -> int:
    """Extract one page through the real provider. Returns characters read."""
    # Imported here, not at module scope: without an endpoint the SDK is not
    # installed, and an unconditional import would fail the search smoke too.
    from plugins.web.firecrawl.provider import FirecrawlWebSearchProvider

    assert_points_at_our_instance()
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
    have_url = bool((os.environ.get("FIRECRAWL_API_URL") or "").strip())
    have_key = bool((os.environ.get("FIRECRAWL_API_KEY") or "").strip())
    # Checked before any network work. The dangerous half is a key with no
    # endpoint: the plugin accepts it and quietly calls Firecrawl's cloud with
    # our token. Skipping on that combination is how a smoke looks away from
    # the one state it exists to catch, so it fails instead — and it fails
    # here, where no search backend being slow or rate-limited can mask it.
    # Neither present is the documented ddgs fallback and proves nothing.
    if have_key and not have_url:
        raise SystemExit(
            "FIRECRAWL_API_KEY is set with no FIRECRAWL_API_URL; "
            "extraction would fall back to hosted Firecrawl"
        )
    configured = have_url and have_key
    if configured:
        assert_points_at_our_instance()

    report = {"ok": True, "backend": check_search()}

    if configured:
        report["extract_backend"] = "firecrawl"
        report["extract_endpoint"] = assert_points_at_our_instance()
        report["extract_chars"] = check_extract()
    else:
        report["extract_backend"] = None

    print(json.dumps(report))


if __name__ == "__main__":
    main()
