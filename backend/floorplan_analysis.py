from __future__ import annotations

import base64
from pathlib import Path

import cv2
import numpy as np
import pymupdf as fitz


def load_page(data: bytes, filename: str, page_number: int) -> np.ndarray:
    """Decode the uploaded image or rasterize the requested original PDF page."""
    if Path(filename).suffix.lower() == ".pdf":
        try:
            document = fitz.open(stream=data, filetype="pdf")
        except Exception as exc:
            raise ValueError("Could not open this PDF.") from exc
        if page_number < 1 or page_number > document.page_count:
            raise ValueError(f"Page must be between 1 and {document.page_count}.")
        page = document.load_page(page_number - 1)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        rgb = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
        image = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    else:
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Could not decode this image.")
    if image.shape[0] < 80 or image.shape[1] < 80:
        raise ValueError("Floor plan page is too small to analyze.")
    return image


def get_document_page_count(data: bytes, filename: str) -> int:
    """Return the total number of pages in the uploaded PDF, or 1 for raster images."""
    if Path(filename).suffix.lower() == ".pdf":
        try:
            document = fitz.open(stream=data, filetype="pdf")
            return document.page_count
        except Exception:
            return 1
    return 1


def preview_data_url(image: np.ndarray, max_edge: int = 2400) -> str:
    """Make a display copy; detection always receives the untouched source raster."""
    height, width = image.shape[:2]
    scale = min(1.0, max_edge / max(height, width))
    display = image if scale == 1 else cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".png", display)
    if not ok:
        raise ValueError("Could not render the plan preview.")
    return "data:image/png;base64," + base64.b64encode(encoded.tobytes()).decode("ascii")


def render_page_preview(data: bytes, filename: str, page_number: int = 1) -> str:
    return preview_data_url(load_page(data, filename, page_number))


def analyze_floorplan(data: bytes, filename: str, page_number: int = 1) -> dict:
    """Analyze the full decoded image. Semantic vision lives in gemini_floorplan."""
    from gemini_floorplan import analyze_image

    page_count = get_document_page_count(data, filename)
    source = load_page(data, filename, page_number)
    result = analyze_image(source)
    height, width = source.shape[:2]
    return {
        **result,
        "page_number": page_number,
        "page_count": page_count,
        "image_width": width,
        "image_height": height,
        "source_crop": {"x": 0, "y": 0, "width": 1, "height": 1},
        "validated": False,
        "preview_data_url": preview_data_url(source),
        "method": f"Gemini vision candidates · full source raster · {result['model']}",
        "review_notice": "Candidates are unverified. Confirm geometry and labels on the complete source image before graph generation. No exit or route is assumed safe.",
    }
