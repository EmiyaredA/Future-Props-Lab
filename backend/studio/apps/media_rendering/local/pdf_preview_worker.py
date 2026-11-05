"""One PDF per process: isolate PDFium, release handles, never execute document scripts."""

import json
import sys
from pathlib import Path

import pypdfium2 as pdfium


def main() -> None:
    source, action = sys.argv[1:3]
    try:
        with pdfium.PdfDocument(source) as document:
            if not len(document):
                raise ValueError("PDF 没有页面")
            if action == "info":
                print(json.dumps({"page_count": len(document)}))
                return
            target, page_number, size = sys.argv[3:6]
            index = int(page_number) - 1
            if index < 0 or index >= len(document):
                print("page_out_of_range")
                sys.exit(2)
            page = document[index]
            try:
                width, height = page.get_size()
                if min(width, height) <= 0:
                    raise ValueError("无效的 PDF 页面尺寸")
                bitmap = page.render(scale=int(size) / max(width, height))
                try:
                    bitmap.to_pil().save(Path(target), format="WEBP", quality=85)
                finally:
                    bitmap.close()
            finally:
                page.close()
    except (pdfium.PdfiumError, ValueError, OSError):
        # Do not echo document paths, metadata, passwords or parser diagnostics.
        print("pdf_unreadable")
        sys.exit(1)


if __name__ == "__main__":
    main()
