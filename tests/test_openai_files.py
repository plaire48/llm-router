from io import BytesIO
from zipfile import ZipFile

import pytest

from llm_router.errors import RouterError
from llm_router.openai_files import OpenAIFileStore, infer_mime_type


def test_file_store_infers_pdf_when_litellm_drops_mime_and_filename():
    store = OpenAIFileStore()

    uploaded = store.add(
        b"%PDF-test",
        filename="upload",
        mime_type="application/octet-stream",
        purpose="assistants",
    )

    assert uploaded.mime_type == "application/pdf"
    assert store.resolve(uploaded.id) == (b"%PDF-test", "application/pdf", "upload")


def test_file_store_detects_office_open_xml_archives():
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "types")
        archive.writestr("word/document.xml", "document")

    assert (
        infer_mime_type(
            output.getvalue(),
            filename="upload",
            declared="application/octet-stream",
        )
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


def test_file_store_rejects_empty_and_oversized_uploads():
    store = OpenAIFileStore(max_upload_bytes=3)

    with pytest.raises(RouterError) as empty:
        store.add(b"", filename="x", mime_type="text/plain", purpose="assistants")
    with pytest.raises(RouterError) as large:
        store.add(b"four", filename="x", mime_type="text/plain", purpose="assistants")

    assert empty.value.code == "invalid_file"
    assert large.value.code == "file_too_large"


def test_file_store_delete_removes_upload():
    store = OpenAIFileStore()
    uploaded = store.add(
        b"data",
        filename="x.bin",
        mime_type="application/octet-stream",
        purpose="assistants",
    )

    assert store.delete(uploaded.id) is True
    assert store.get(uploaded.id) is None
    assert store.delete(uploaded.id) is False
