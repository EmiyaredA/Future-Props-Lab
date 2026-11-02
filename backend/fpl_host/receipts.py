"""Persist intent before execution and results before acknowledgement; never repeat unknown work."""

import hashlib
import json
import os
import tempfile
from pathlib import Path

from fpl_runtime.native_protocol import NativeLease, NativeOutcome


def canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def command_digest(lease):
    return hashlib.sha256(
        canonical(
            {
                "owner": lease.owner_user_id,
                "operation": lease.operation,
                "payload": lease.payload,
            }
        ).encode()
    ).hexdigest()


class ReceiptStore:
    def __init__(self, root: Path, *, readonly_operations=()):
        if root.is_symlink():
            raise ValueError("原生回执目录不能是符号链接")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root.chmod(0o700)
        self.root = root.resolve()
        self.readonly_operations = frozenset(readonly_operations)

    def _path(self, lease):
        return self.root / (str(lease.job_id) + ".json")

    def publish(self, path, document):
        fd, temporary = tempfile.mkstemp(prefix=".receipt-", dir=self.root)
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(canonical(document))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def execute(self, lease: NativeLease, action):
        path = self._path(lease)
        digest = command_digest(lease)
        if path.is_symlink():
            raise ValueError("原生回执不能是符号链接")
        if path.exists():
            document = json.loads(path.read_text())
            if document["command_sha256"] != digest:
                raise ValueError("同一任务 ID 的操作或账号发生变化")
            if document["lease"]["lease_id"] != str(lease.lease_id):
                return NativeOutcome(
                    status="unknown",
                    error_code="lease_changed",
                    message="已有执行意图；拒绝用新租约重复执行",
                )
            if document.get("outcome") is not None:
                return NativeOutcome.model_validate(document["outcome"])
            outcome = NativeOutcome(
                status="unknown",
                error_code="execution_interrupted",
                message="执行已开始但没有持久结果，必须核对原动作后恢复",
            )
        else:
            document = {
                "version": 1,
                "command_sha256": digest,
                "lease": lease.model_dump(mode="json"),
                "outcome": None,
                "acknowledged": False,
            }
            self.publish(path, document)
            try:
                result = action(lease.operation, lease.payload)
                outcome = NativeOutcome(status="completed", result=result)
            except Exception as exc:
                outcome = NativeOutcome(
                    status=("failed" if lease.operation in self.readonly_operations else "unknown"),
                    error_code=type(exc).__name__,
                    message="原生操作未能生成确定结果",
                )
        document["outcome"] = outcome.model_dump(mode="json")
        self.publish(path, document)
        return outcome

    def pending(self):
        for path in sorted(self.root.glob("*.json")):
            if path.is_symlink():
                raise ValueError("原生回执不能是符号链接")
            document = json.loads(path.read_text())
            if not document.get("acknowledged"):
                yield NativeLease.model_validate(document["lease"]), document.get("outcome")

    def acknowledge(self, lease):
        path = self._path(lease)
        if path.is_symlink():
            raise ValueError("原生回执不能是符号链接")
        document = json.loads(path.read_text())
        if document["lease"]["lease_id"] != str(lease.lease_id):
            raise ValueError("回执租约不一致")
        document["acknowledged"] = True
        self.publish(path, document)
