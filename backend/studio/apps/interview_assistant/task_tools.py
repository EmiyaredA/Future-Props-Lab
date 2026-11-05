"""Credential-free stdio MCP: task-local documents and flat scratch files only.

This module must not import the application runtime, ORM, configuration or HTTP clients.
"""

import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path

from defusedxml import ElementTree
from mcp.server import MCPServer
from pypdf import PdfReader

MAX_TEXT = 120_000
MAX_FILE = 10 * 1024 * 1024
NAME = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$")


def safe_read(path: Path, limit=MAX_FILE) -> bytes:
    cursor = path
    while cursor != cursor.parent:
        if cursor.is_symlink():
            raise ValueError("禁止符号链接")
        cursor = cursor.parent
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("文件超出读取限制")
    return data


def extract_document(path: Path) -> dict:
    """Full extraction or explicit incompleteness, never filename-based inference."""
    data = safe_read(path)
    suffix = path.suffix.lower()
    try:
        if suffix == ".pdf":
            import io

            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted or len(reader.pages) > 100:
                raise ValueError("PDF 已加密或超过 100 页，请粘贴文字")
            sections = [
                {"location": f"page:{i + 1}", "text": page.extract_text() or ""}
                for i, page in enumerate(reader.pages)
            ]
            complete = bool(sections) and all(section["text"].strip() for section in sections)
        elif suffix == ".docx":
            import io

            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if (
                    len(entries) > 2000
                    or sum(item.file_size for item in entries) > 40 * 1024 * 1024
                    or any(item.flag_bits & 1 for item in entries)
                ):
                    raise ValueError("DOCX 压缩结构不受支持")
                document = ElementTree.fromstring(archive.read("word/document.xml"))
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            sections = [
                {"location": f"paragraph:{i + 1}", "text": "".join(node.itertext())}
                for i, node in enumerate(document.findall(".//w:p", ns))
            ]
            complete = any(section["text"].strip() for section in sections)
        else:
            text = data.decode("utf-8-sig")
            sections = [
                {"location": f"line:{i + 1}", "text": line}
                for i, line in enumerate(text.splitlines())
            ]
            complete = bool(text.strip())
        if sum(len(section["text"]) for section in sections) > MAX_TEXT:
            raise ValueError("文本超过 120000 字，请提供较短版本")
        return {
            "complete": complete,
            "sections": sections,
            "message": "读取完成" if complete else "存在空白或扫描页面，无法完整读取，请补充文字",
        }
    except Exception:
        # Parsers may include document data or paths in exceptions. Never forward those.
        return {
            "complete": False,
            "sections": [],
            "message": "无法完整读取此文件（加密、扫描、损坏或超限），请补充文字并重新准备",
        }


class TaskFiles:
    def __init__(self, root: Path):
        self.root = root.resolve(strict=True)
        if root.is_symlink():
            raise ValueError("任务目录不能是符号链接")
        self.manifest = json.loads(safe_read(self.root / "manifest.json", 100_000))

    def read_input(self, file_id: str) -> dict:
        entry = self.manifest["files"].get(file_id)
        if entry is None:
            raise ValueError("输入标识不存在")
        name = entry["name"]
        if not NAME.fullmatch(name):
            raise ValueError("输入标识无效")
        path = self.root / "input" / name
        if hashlib.sha256(safe_read(path)).hexdigest() != entry["sha256"]:
            raise ValueError("输入快照已变化")
        result = extract_document(path)
        receipts = self.root / "receipts"
        receipts.mkdir(exist_ok=True, mode=0o700)
        destination = receipts / f"{file_id}.json"
        if not NAME.fullmatch(file_id) or receipts.is_symlink():
            raise ValueError("文件标识无效")
        descriptor = os.open(
            destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600
        )
        with os.fdopen(descriptor, "w") as stream:
            json.dump(
                {"file_id": file_id, "sha256": entry["sha256"], **result},
                stream,
                ensure_ascii=False,
            )
        return {"file_id": file_id, **result}

    def work_file(self, name: str) -> Path:
        if not NAME.fullmatch(name) or ".." in name:
            raise ValueError("工作文件只能使用单层文件名")
        path = self.root / "work" / name
        if path.parent.is_symlink() or path.is_symlink():
            raise ValueError("禁止符号链接")
        return path

    def write_work(self, name: str, content: str) -> dict:
        data = content.encode()
        if len(data) > 256_000:
            raise ValueError("草稿不能超过 256 KB")
        path = self.work_file(name)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        return {"name": name, "bytes": len(data)}

    def read_work(self, name: str) -> str:
        return safe_read(self.work_file(name), 256_000).decode()


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: fpl-interview-tools <task-root>")
    files = TaskFiles(Path(sys.argv[1]))
    server = MCPServer("interview_task")
    server.tool(
        description="读取本任务输入：jd、resume、supplement（若存在）。返回完整性和原文定位。"
    )(files.read_input)
    server.tool(description="写入本任务工作草稿；不能写入输入或交付区。")(files.write_work)
    server.tool(description="读取本任务工作草稿。")(files.read_work)
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
