"""Local-only conversion sidecar. No LLM, plugin, URL input or document upload."""
import json
import sys
from pathlib import Path

ALLOWED = {".pdf", ".docx", ".pptx", ".xlsx", ".html", ".htm", ".txt", ".md", ".markdown", ".csv"}


def convert(request):
    # Use the Windows/macOS certificate store, including installed enterprise
    # roots. Never disable HTTPS verification to download OCR model weights.
    import truststore
    truststore.inject_into_ssl()
    root = Path(request["root"]).resolve(strict=True)
    source = Path(request["path"]).resolve(strict=True)
    if source.parent != root or source.suffix.lower() not in ALLOWED or source.stat().st_size > 200 * 1024 * 1024:
        raise ValueError("markdown_source_invalid")
    engine = request["engine"]
    if engine == "markitdown":
        from markitdown import MarkItDown
        result = MarkItDown(enable_plugins=False).convert_local(str(source))
        evidence = []
        if source.suffix.lower() in (".html", ".htm"):
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(source.read_bytes(), "html.parser")
            for node in soup(["script", "style", "template"]):
                node.decompose()
            evidence = [text.strip() for text in soup.get_text("\n").splitlines() if text.strip()]
        elif source.suffix.lower() in (".txt", ".md", ".markdown", ".csv"):
            from charset_normalizer import from_bytes
            match = from_bytes(source.read_bytes()).best()
            if match is None:
                raise ValueError("markdown_encoding_unknown")
            evidence = [text for text in str(match).splitlines() if text.strip()]
        return {"engine": engine, "markdown": result.markdown, "evidence": evidence, "warnings": [], "complete": True}
    if engine != "docling":
        raise ValueError("markdown_engine_invalid")
    try:
        import onnxruntime
        onnxruntime.disable_telemetry_events()
    except ImportError:
        pass
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat, ConversionStatus
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions, TableFormerMode
    from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
    options = PdfPipelineOptions()
    options.enable_remote_services = False
    options.do_picture_description = False
    options.do_picture_classification = False
    options.generate_page_images = False
    options.generate_picture_images = False
    options.do_ocr = True
    options.ocr_options = RapidOcrOptions(lang=["iso:ko"], backend="onnxruntime")
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.accelerator_options = AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=4)
    converter = DocumentConverter(allowed_formats=[InputFormat.PDF, InputFormat.DOCX, InputFormat.PPTX, InputFormat.XLSX, InputFormat.HTML, InputFormat.MD, InputFormat.CSV], format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
    result = converter.convert(source, raises_on_error=False, max_num_pages=2000, max_file_size=200 * 1024 * 1024)
    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        raise ValueError("markdown_conversion_failed")
    document = result.document
    from docling_core.types.doc import ImageRefMode
    markdown = document.export_to_markdown(image_mode=ImageRefMode.PLACEHOLDER, image_placeholder="")
    data = document.export_to_dict()
    # Keep the lossless JSON internal; only expose factual text/count evidence,
    # not image bytes, to the worker's quality checks or agent context.
    evidence = [item.get("text", "") for item in data.get("texts", []) if item.get("text")]
    evidence += [cell["text"] for table in data.get("tables", []) for cell in table.get("data", {}).get("table_cells", []) if cell.get("text")]
    warnings = []
    import math
    ocr_cells = [cell for page in result.pages for cell in page.cells if getattr(cell, "from_ocr", False)]
    scores = [float(cell.confidence) for cell in ocr_cells if math.isfinite(float(cell.confidence))]
    page_scores = [float(c.ocr_score) for c in result.confidence.pages.values() if math.isfinite(float(c.ocr_score))]
    ocr = {"used": bool(ocr_cells or page_scores), "recognizedRegions": len(ocr_cells) if ocr_cells else None, "minimumConfidence": min(scores or page_scores) if (scores or page_scores) else None}
    if ocr["used"]:
        warnings.append("OCR로 읽은 내용은 글자·숫자를 원문과 대조해 주세요.")
        if ocr["minimumConfidence"] is not None and ocr["minimumConfidence"] < 0.85:
            warnings.append("인식 신뢰도가 낮은 OCR 영역이 있어 확인이 필요합니다.")
    if result.status == ConversionStatus.PARTIAL_SUCCESS or result.errors:
        warnings.append("Docling이 일부 페이지 또는 요소를 완전히 분석하지 못했습니다.")
    pages = data.get("pages", {})
    page_text = {int(k): False for k in pages}
    for item in data.get("texts", []) + data.get("tables", []):
        for prov in item.get("prov", []):
            if prov.get("page_no") in page_text:
                page_text[prov["page_no"]] = True
    empty_pages = [k for k, has_text in page_text.items() if not has_text]
    if empty_pages:
        warnings.append("텍스트나 표를 추출하지 못한 페이지: " + ", ".join(map(str, empty_pages)))
    return {"engine": engine, "markdown": markdown, "evidence": evidence, "pages": len(pages), "tables": len(data.get("tables", [])), "warnings": warnings, "ocr": ocr, "complete": not warnings, "structure": data}


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read(16384))
        result = convert(request)
        encoded = json.dumps(result, ensure_ascii=False)
        if len(encoded.encode("utf-8")) > 64 * 1024 * 1024:
            raise ValueError("markdown_output_limit")
        print("NUBI_DOCUMENT_RESULT:" + encoded)
    except Exception as error:
        # Native filesystem paths, document content, credentials and library
        # traceback never enter the user-facing protocol.
        code = str(error) if isinstance(error, ValueError) and str(error).startswith("markdown_") else "markdown_conversion_failed"
        import ssl
        from urllib.error import URLError
        if isinstance(error, ModuleNotFoundError):
            code = "markdown_dependency_missing"
        if isinstance(error, (ssl.SSLCertVerificationError, URLError)):
            code = "markdown_model_download_failed"
        print("NUBI_DOCUMENT_RESULT:" + json.dumps({"error": code, "exception": type(error).__name__}))
        sys.exit(1)
