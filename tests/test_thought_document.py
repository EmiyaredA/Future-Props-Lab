from __future__ import annotations

import pytest

from app.apps.thought_workshop.schemas.document import document_text, validate_document


def _image_doc(**attrs):
    return {
        "type": "doc",
        "content": [
            {
                "type": "image",
                "attrs": {"assetId": "img-1", "width": 320, "alt": "替代", **attrs},
            }
        ],
    }


def test_image_caption_and_crop_are_accepted():
    doc = _image_doc(
        caption="图注说明",
        align="center",
        cropLeft=10,
        cropTop=20,
        cropWidth=50,
        cropHeight=40,
    )
    assert validate_document(doc)["content"][0]["attrs"]["caption"] == "图注说明"
    assert validate_document(doc)["content"][0]["attrs"]["align"] == "center"
    text = document_text(doc)
    assert "图注说明" in text
    assert "替代" in text


def test_image_crop_requires_complete_valid_rect():
    with pytest.raises(ValueError, match="裁剪参数必须完整"):
        validate_document(_image_doc(cropLeft=10, cropWidth=50))
    with pytest.raises(ValueError, match="裁剪区域无效"):
        validate_document(_image_doc(cropLeft=60, cropTop=0, cropWidth=50, cropHeight=100))
    with pytest.raises(ValueError, match="裁剪参数无效"):
        validate_document(_image_doc(cropLeft=0, cropTop=0, cropWidth=0, cropHeight=50))


def test_image_alignment_is_limited_to_supported_values():
    with pytest.raises(ValueError, match="图片对齐方式无效"):
        validate_document(_image_doc(align="justify"))
