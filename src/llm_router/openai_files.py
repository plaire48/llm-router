from __future__ import annotations

import time
import uuid
import zipfile
from dataclasses import dataclass
from io import BytesIO
from mimetypes import guess_type

from llm_router.errors import RouterError

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_UPLOADS = 128
UPLOAD_TTL_SECONDS = 60 * 60


def _zip_mime_type(data: bytes) -> str | None:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            names = set(archive.namelist())
    except (OSError, zipfile.BadZipFile):
        return None
    if any(name.startswith("word/") for name in names):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if any(name.startswith("xl/") for name in names):
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if any(name.startswith("ppt/") for name in names):
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    return "application/zip"


def infer_mime_type(data: bytes, *, filename: str, declared: str) -> str:
    normalized = declared.split(";", 1)[0].strip().lower()
    if normalized and normalized != "application/octet-stream":
        return normalized
    guessed, _ = guess_type(filename)
    if guessed:
        return guessed
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        return "audio/wav"
    if data.startswith(b"fLaC"):
        return "audio/flac"
    if data.startswith(b"ID3"):
        return "audio/mpeg"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "video/mp4"
    if data.startswith(b"PK\x03\x04"):
        return _zip_mime_type(data) or "application/zip"
    return "application/octet-stream"


@dataclass(frozen=True)
class UploadedFile:
    id: str
    data: bytes
    filename: str
    mime_type: str
    purpose: str
    created_at: int

    def metadata(self) -> dict[str, object]:
        return {
            "id": self.id,
            "object": "file",
            "bytes": len(self.data),
            "created_at": self.created_at,
            "filename": self.filename,
            "purpose": self.purpose,
            "status": "processed",
            "status_details": None,
        }


class OpenAIFileStore:
    """Short-lived uploads used by LiteLLM before an OpenCode chat request."""

    def __init__(
        self,
        *,
        max_upload_bytes: int = MAX_UPLOAD_BYTES,
        max_uploads: int = MAX_UPLOADS,
        ttl_seconds: float = UPLOAD_TTL_SECONDS,
    ) -> None:
        self.max_upload_bytes = max_upload_bytes
        self.max_uploads = max_uploads
        self.ttl_seconds = ttl_seconds
        self._files: dict[str, UploadedFile] = {}

    def add(
        self,
        data: bytes,
        *,
        filename: str,
        mime_type: str,
        purpose: str,
    ) -> UploadedFile:
        if not data:
            raise RouterError(
                "uploaded files must not be empty",
                type="invalid_request_error",
                code="invalid_file",
                status_code=422,
            )
        if len(data) > self.max_upload_bytes:
            raise RouterError(
                f"uploaded files must not exceed {self.max_upload_bytes} bytes",
                type="invalid_request_error",
                code="file_too_large",
                status_code=413,
            )
        self._expire()
        while len(self._files) >= self.max_uploads:
            oldest = min(self._files.values(), key=lambda item: item.created_at)
            self._files.pop(oldest.id, None)
        effective_mime = infer_mime_type(data, filename=filename, declared=mime_type)
        uploaded = UploadedFile(
            id=f"file-router-{uuid.uuid4().hex}",
            data=data,
            filename=filename or "upload",
            mime_type=effective_mime,
            purpose=purpose,
            created_at=int(time.time()),
        )
        self._files[uploaded.id] = uploaded
        return uploaded

    def get(self, file_id: str) -> UploadedFile | None:
        self._expire()
        return self._files.get(file_id)

    def resolve(self, file_id: str) -> tuple[bytes, str, str] | None:
        uploaded = self.get(file_id)
        if uploaded is None:
            return None
        return uploaded.data, uploaded.mime_type, uploaded.filename

    def delete(self, file_id: str) -> bool:
        self._expire()
        return self._files.pop(file_id, None) is not None

    def clear(self) -> None:
        self._files.clear()

    def _expire(self) -> None:
        threshold = time.time() - self.ttl_seconds
        expired = [
            file_id for file_id, uploaded in self._files.items() if uploaded.created_at < threshold
        ]
        for file_id in expired:
            self._files.pop(file_id, None)
