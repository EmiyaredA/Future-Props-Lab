"""Oversized inline images remain readable without retaining their encoded bytes."""

import io
import json

import pytest
import zstandard

from app.capabilities.agents.sessions import files
from app.capabilities.agents.sessions.inline_images import compact_image_record


@pytest.mark.parametrize("chunk_size", [1, 2, 7, 127, 512])
def test_inline_images_compact_across_utf8_and_escaped_string_boundaries(chunk_size):
    record = {
        "before": '中文 \\"data:image/png;base64,text"',
        "image": "data:image/png;base64," + "A/" * 3000,
        "after": 'follow up \\"keep"',
        "images": ["data:image/jpeg;base64," + "B" * 2000, "file:///unchanged.png"],
    }
    raw = (json.dumps(record, ensure_ascii=False) + "\n").encode().replace(b"A/", b"A\\/")
    stream = io.BytesIO(raw)
    compact, consumed = compact_image_record(
        stream, stream.read(513), limit=512, wire_limit=len(raw), chunk_size=chunk_size
    )
    value = json.loads(compact)
    assert consumed == len(raw)
    assert value["before"] == record["before"] and value["after"] == record["after"]
    assert value["images"][1] == record["images"][1]
    assert value["image"] == value["images"][0] == "data:image/png;base64,"


def test_oversized_non_image_text_and_unbounded_wire_are_rejected():
    with pytest.raises(ValueError, match="去除内嵌图片后"):
        compact_image_record(
            io.BytesIO(),
            b'{"text":"' + b"A" * 2000 + b'"}\n',
            limit=512,
            wire_limit=4096,
            chunk_size=128,
        )
    with pytest.raises(ValueError, match="原始体积"):
        compact_image_record(
            io.BytesIO(),
            b'{"image":"data:image/png;base64,' + b"A" * 2000 + b'"}\n',
            limit=512,
            wire_limit=1024,
            chunk_size=128,
        )


@pytest.mark.parametrize("compressed", [False, True])
def test_large_inline_image_checkpoint_counts_original_bytes_and_retries_half_line(
    tmp_path, monkeypatch, compressed
):
    monkeypatch.setattr(files, "MAX_RECORD", 512)
    monkeypatch.setattr(files, "MAX_CHUNK", 128)
    header = b'{"type":"session","id":"s"}\n'
    image = b'{"type":"image","url":"data:image/png;base64,' + b"A" * 2000 + b'"}\n'
    following = b'{"type":"message","text":"next"}\n'
    path = tmp_path / "record.jsonl"
    compressor = zstandard.ZstdCompressor()

    def write(data):
        path.write_bytes(compressor.compress(data) if compressed else data)

    write(header + image[:-2])
    first, state, _, _ = files.read_records(str(tmp_path), path.name, {})
    assert first == [(0, json.loads(header))]
    assert state["offset"] == len(header)
    # Completing the same native record must preserve offsets, ids and the next record.
    write(header + image + following)
    # Recompression changes the prefix, so the compressed source correctly resets.
    second, state, reset, _ = files.read_records(str(tmp_path), path.name, state)
    if reset:
        assert second[0] == (0, json.loads(header))
    assert second[-1][0] == len(header)
    assert len(second[-1][1]["url"]) < 50
    assert state["offset"] == len(header) + len(image)
    last, state, reset, complete = files.read_records(str(tmp_path), path.name, state)
    assert not reset and complete
    assert last == [(len(header) + len(image), json.loads(following))]
    assert state["offset"] == len(header) + len(image) + len(following)
