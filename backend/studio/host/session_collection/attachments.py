"""Only explicitly referenced regular files beneath an approved source root are readable."""

import hashlib
from pathlib import Path
from urllib.parse import unquote, urlsplit

from studio.host.session_collection.files import open_regular


def reference(value):
    if not isinstance(value, str) or value.startswith("data:"):
        return []
    url = urlsplit(value)
    if url.scheme == "file" and url.netloc not in {"", "localhost"}:
        return []
    if url.scheme not in {"", "file"}:
        return []
    path = unquote(url.path) if url.scheme == "file" else value
    if not path:
        return []
    return [
        {
            "id": hashlib.sha256(path.encode()).hexdigest()[:24],
            "name": Path(path).name,
            "reference": path,
        }
    ]


def read_reference(root: str, value: str):
    base = Path(root).resolve(strict=True)
    native = Path(value)
    relative = str(native.relative_to(base)) if native.is_absolute() else value
    with open_regular(root, relative) as stream:
        data = stream.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            raise ValueError("附件超过读取上限")
        return data, native.name
