from __future__ import annotations

import base64

import pytest

from app.console.amadeus import model_bridge
from studio.runtime.database.operation_receipts import OperationError


def test_model_bridge_accepts_bounded_image_inputs_only() -> None:
    valid = base64.b64encode(b"frame").decode("ascii")
    groups = model_bridge._message_images(
        [
            {
                "role": "user",
                "images": [{"mime_type": "image/jpeg", "data_base64": valid}],
            }
        ]
    )
    assert groups[0][0].byte_size == 5
    audited = model_bridge._audit_messages(
        [
            {
                "role": "user",
                "images": [
                    {
                        "mime_type": "image/jpeg",
                        "byte_size": 5,
                        "data_base64": valid,
                    }
                ],
            }
        ]
    )
    assert audited[0]["images"] == [{"mime_type": "image/jpeg", "byte_size": 5}]
    assert valid not in str(audited)
    with pytest.raises(OperationError, match="格式不支持"):
        model_bridge._message_images(
            [{"images": [{"mime_type": "video/mp4", "data_base64": valid}]}]
        )
    oversized = base64.b64encode(b"x" * (model_bridge.MAX_IMAGE_BYTES + 1)).decode("ascii")
    with pytest.raises(OperationError, match="不得超过 350 KiB"):
        model_bridge._message_images(
            [{"images": [{"mime_type": "image/jpeg", "data_base64": oversized}]}]
        )
