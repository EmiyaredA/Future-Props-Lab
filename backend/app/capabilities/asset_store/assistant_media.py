"""Read bounded media projections for an already-authorized assistant attachment."""

from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_DOCUMENT_CHARS = 50_000
MAX_PDF_PAGES = 50
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
ALLOWED_MEDIA_KINDS = {"image", "video", "audio", "document"}


class AssistantAssetError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_asset", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def avif_as_png(content: bytes, display_name: str) -> bytes:
    try:
        with Image.open(BytesIO(content)) as image:
            if str(image.format or "").upper() != "AVIF":
                raise AssistantAssetError(f"AVIF 图片内容无效：{display_name}")
            image.load()
            has_alpha = image.mode in {"RGBA", "LA"} or "transparency" in image.info
            converted = image.convert("RGBA" if has_alpha else "RGB")
            output = BytesIO()
            converted.save(output, format="PNG", optimize=True)
            return output.getvalue()
    except AssistantAssetError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError):
        raise AssistantAssetError(f"AVIF 图片内容无效：{display_name}") from None


def read_image(path, mime_type, display_name):
    if not path.is_file():
        raise AssistantAssetError(
            f"图片内容不存在：{display_name}", code="file_missing", status=409
        )
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise AssistantAssetError("图片不能超过 8MB", code="file_too_large", status=413)
    content = path.read_bytes()
    if mime_type == "image/avif":
        return avif_as_png(content, display_name), "image/png"
    return content, mime_type


def read_document(path, mime_type, display_name):
    if not path.is_file():
        return "", f"附件内容不存在：{display_name}"
    if mime_type == "application/pdf":
        return read_pdf(path)
    if mime_type in {"text/plain", "text/markdown"}:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return "", f"文本附件无法按 UTF-8 读取：{display_name}"
        warning = None
        if len(text) > MAX_DOCUMENT_CHARS:
            text = text[:MAX_DOCUMENT_CHARS]
            warning = f"文本正文已截断为 {MAX_DOCUMENT_CHARS} 字符"
        return text, warning
    return "", "此文档类型暂不支持正文提取"


def read_pdf(path: Path) -> tuple[str, str | None]:
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            try:
                if reader.decrypt("") == 0:
                    return "", "PDF 已加密，无法提取正文"
            except Exception:
                return "", "PDF 已加密，无法提取正文"
        parts: list[str] = []
        for page in reader.pages[:MAX_PDF_PAGES]:
            parts.append(page.extract_text() or "")
        text = "\n".join(parts).strip()
        if not text:
            return "", "PDF 未提取到可读正文"
        warnings: list[str] = []
        if len(reader.pages) > MAX_PDF_PAGES:
            warnings.append(f"PDF 仅读取前 {MAX_PDF_PAGES} 页")
        if len(text) > MAX_DOCUMENT_CHARS:
            text = text[:MAX_DOCUMENT_CHARS]
            warnings.append(f"PDF 正文已截断为 {MAX_DOCUMENT_CHARS} 字符")
        return text, "；".join(warnings) or None
    except Exception:
        return "", "PDF 解析失败，已仅提供文件元数据"
