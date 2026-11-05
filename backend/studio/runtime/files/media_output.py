"""Local derived output lifecycle, with no business state or response implementation."""

import shutil
from pathlib import Path


class FileMediaOutput:
    def __init__(self, path: Path, media_type: str, *, temporary=False):
        self.path = path
        self.filename, self.media_type, self.byte_size = path.name, media_type, path.stat().st_size
        self.temporary, self.closed = temporary, False

    def open(self):
        if self.closed:
            raise RuntimeError("Media output is closed")
        return self.path.open("rb")

    def close(self):
        if not self.closed:
            self.closed = True
            if self.temporary:
                shutil.rmtree(self.path.parent, ignore_errors=True)
