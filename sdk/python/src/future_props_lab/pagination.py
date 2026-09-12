"""Explicit page adapters accommodate the platform's existing pagination contracts."""


def iter_pages(fetch, *, offset=0, limit=100):
    if offset < 0 or limit < 1:
        raise ValueError("offset must be nonnegative and limit positive")
    while True:
        page = fetch(offset=offset, limit=limit)
        items = page["items"] if isinstance(page, dict) else page.items
        yield from items
        total = page.get("total") if isinstance(page, dict) else getattr(page, "total", None)
        offset += len(items)
        if not items or (total is not None and offset >= total) or len(items) < limit:
            return


async def aiter_pages(fetch, *, offset=0, limit=100):
    if offset < 0 or limit < 1:
        raise ValueError("offset must be nonnegative and limit positive")
    while True:
        page = await fetch(offset=offset, limit=limit)
        items = page["items"] if isinstance(page, dict) else page.items
        for item in items:
            yield item
        total = page.get("total") if isinstance(page, dict) else getattr(page, "total", None)
        offset += len(items)
        if not items or (total is not None and offset >= total) or len(items) < limit:
            return
