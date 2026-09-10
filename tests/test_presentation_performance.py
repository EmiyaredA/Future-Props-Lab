"""Opt-in isolated export measurement; no persistent database is accessed."""

import json
import os
import resource
import time
import tracemalloc
from pathlib import Path

import pytest
from tests.presentation_helpers import element

from app.presentation_workshop.exports import build_export
from app.schemas.presentation_workshop import PresentationProjectOut


@pytest.mark.skipif(
    not os.environ.get("FPL_PRESENTATION_QA_DIR"), reason="explicit QA output required"
)
def test_hundred_page_export_memory():
    snapshot = PresentationProjectOut.model_validate(
        {
            "id": "performance",
            "title": "百页内存测量",
            "revision": 0,
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
            "document": {
                "version": 1,
                "width": 1280,
                "height": 720,
                "slides": [
                    {
                        "id": f"page-{i}",
                        "background": "#FFFFFF",
                        "notes": f"第 {i + 1} 页备注",
                        "elements": [
                            element(
                                id=f"element-{i}-{j}",
                                x=(j % 5) * 245 + 20,
                                y=(j // 5) * 160 + 20,
                                width=230,
                                height=140,
                            )
                            for j in range(20)
                        ],
                    }
                    for i in range(100)
                ],
            },
        }
    )
    rss_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    tracemalloc.start()
    start = time.perf_counter()
    result = build_export(snapshot, {})
    try:
        elapsed = time.perf_counter() - start
        _, peak = tracemalloc.get_traced_memory()
        metrics = {
            "pages": 100,
            "elementsPerPage": 20,
            "exportSecondsWithTracemalloc": elapsed,
            "pythonAllocationPeakBytes": peak,
            "processPeakRssBefore": rss_before,
            "processPeakRssAfter": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "rssUnit": "bytes on macOS; KiB on Linux",
            "pptxBytes": result.path.stat().st_size,
        }
        root = Path(os.environ["FPL_PRESENTATION_QA_DIR"])
        root.mkdir(parents=True, exist_ok=True)
        (root / "export-memory.json").write_text(json.dumps(metrics, indent=2))
        assert result.path.stat().st_size > 0
    finally:
        tracemalloc.stop()
        result.cleanup()
