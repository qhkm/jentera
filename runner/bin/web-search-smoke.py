#!/usr/bin/env python3
"""Prove Hermes has a usable live search backend without invoking the model."""

from __future__ import annotations

import json

from plugins.web.ddgs.provider import DDGSWebSearchProvider


def main() -> None:
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

    print(json.dumps({"ok": True, "backend": provider.name, "results": len(valid)}))


if __name__ == "__main__":
    main()
