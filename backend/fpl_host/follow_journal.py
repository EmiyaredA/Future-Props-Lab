"""One bounded unacknowledged frame per follow task; originals are never modified."""

import json
from pathlib import Path
from uuid import uuid4

from fpl_runtime.native_protocol import NativeLease

from .receipts import ReceiptStore, canonical, command_digest


class FollowJournal:
    def __init__(self, root):
        self.storage = ReceiptStore(Path(root))

    def path(self, lease):
        return self.storage.root / (str(lease.job_id) + ".json")

    def read(self, lease):
        path = self.path(lease)
        if path.is_symlink():
            raise ValueError("跟随回执不能是符号链接")
        if path.exists():
            document = json.loads(path.read_text())
            if document["command_sha256"] != command_digest(lease) or document["lease"][
                "lease_id"
            ] != str(lease.lease_id):
                raise ValueError("跟随任务身份或租约发生变化")
            return document
        document = {
            "version": 1,
            "lease": lease.model_dump(mode="json"),
            "command_sha256": command_digest(lease),
            "pending": None,
            "ended": False,
        }
        self.storage.publish(path, document)
        return document

    def stage(self, lease, *, locator, expected, batch):
        document = self.read(lease)
        if document["pending"] is not None or document["ended"]:
            raise ValueError("上一帧尚未确认或跟随已结束")
        frame = {
            "lease": lease.model_dump(mode="json"),
            "frame_id": str(uuid4()),
            "locator": locator,
            "expected": expected,
            "batch": batch,
        }
        if len(canonical(frame).encode()) > 32 * 1024 * 1024:
            raise ValueError("原生同步帧超过限制")
        document["pending"] = frame
        self.storage.publish(self.path(lease), document)
        return frame

    def acknowledge(self, lease, frame_id):
        document = self.read(lease)
        if not document["pending"] or document["pending"]["frame_id"] != frame_id:
            raise ValueError("跟随帧确认不匹配")
        document["pending"] = None
        self.storage.publish(self.path(lease), document)

    def end(self, lease):
        document = self.read(lease)
        document["ended"] = True
        # Keep unacknowledged content for recovery; it may be the only remaining copy.
        self.storage.publish(self.path(lease), document)

    def recover(self):
        for path in sorted(self.storage.root.glob("*.json")):
            if path.is_symlink():
                raise ValueError("跟随回执不能是符号链接")
            document = json.loads(path.read_text())
            lease = NativeLease.model_validate(document["lease"])
            if not self.read(lease)["ended"]:
                yield lease
