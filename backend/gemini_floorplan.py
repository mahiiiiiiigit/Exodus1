from __future__ import annotations

import os
import logging
import random
import re
import time
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

import cv2
import numpy as np
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

load_dotenv(Path(__file__).with_name(".env"))


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


Coordinate = Annotated[float, Field(ge=0, le=1, strict=True)]


class VisionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["room", "wall", "door", "opening", "corridor", "stairs", "exit", "unknown"]
    polygon_xy: list[Coordinate] = Field(min_length=6, max_length=200)
    label: str
    explicitly_marked_exit: bool
    confidence: float = Field(ge=0, le=1)
    label_confidence: float = Field(ge=0, le=1)
    uncertainty: list[str] = Field(max_length=12)
    label_is_readable: bool

    @model_validator(mode="after")
    def label_matches_readability(self):
        if len(self.polygon_xy) % 2:
            raise ValueError("Polygon coordinates must be x/y pairs.")
        points = list(zip(self.polygon_xy[::2], self.polygon_xy[1::2]))
        if len(set(points)) < 3:
            raise ValueError("A feature polygon needs at least three distinct points.")
        twice_area = abs(sum(
            points[index][0] * points[(index + 1) % len(points)][1]
            - points[(index + 1) % len(points)][0] * points[index][1]
            for index in range(len(points))
        ))
        if twice_area <= 1e-8:
            raise ValueError("A feature polygon must enclose a non-zero area.")
        if self.label_is_readable != bool(self.label.strip()):
            raise ValueError("Readable labels must contain text; unreadable labels must be an empty string.")
        if self.kind != "exit" and self.explicitly_marked_exit:
            raise ValueError("Only exit candidates may be explicitly marked as exits.")
        if self.kind == "exit" and self.explicitly_marked_exit and not self.label_is_readable:
            raise ValueError("An exit candidate must have an explicitly readable label; otherwise use unknown.")
        if not self.label_is_readable and self.label_confidence != 0:
            raise ValueError("Unreadable labels must have zero label confidence.")
        return self

    @property
    def polygon(self) -> list[Point]:
        return [Point(x=self.polygon_xy[index], y=self.polygon_xy[index + 1]) for index in range(0, len(self.polygon_xy), 2)]


class VisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    outline_xy: list[Coordinate] = Field(max_length=600)
    outline_confidence: float = Field(ge=0, le=1)
    outline_uncertainty: list[str] = Field(max_length=12)
    candidates: list[VisionCandidate] = Field(max_length=500)

    @model_validator(mode="after")
    def outline_has_enough_points(self):
        if len(self.outline_xy) % 2:
            raise ValueError("Outline coordinates must be x/y pairs.")
        points = list(zip(self.outline_xy[::2], self.outline_xy[1::2]))
        if points and len(set(points)) < 3:
            raise ValueError("A returned outline needs at least three distinct points.")
        return self

    @property
    def outline(self) -> list[Point]:
        return [Point(x=self.outline_xy[index], y=self.outline_xy[index + 1]) for index in range(0, len(self.outline_xy), 2)]


class GeminiAnalysisError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


PROMPT = """Inspect the complete uploaded architectural floor-plan image. This is an original PNG/JPG or a rasterized original PDF page, or one labeled tile of that source; do not treat it as a browser screenshot or UI. Ignore unrelated page margins, browser chrome, webpage text, furniture, icons, and decorative objects. Extract candidate regions for named rooms (copy only readable names), corridors, walls, door openings, other openings, and staircases. Report an exit only when the plan explicitly labels it as an exit and the label is readable; copy that exact label. Never infer an exit from a door, an exterior wall, a stair, or likely egress. Never invent missing room or exit names. If a feature cannot be identified confidently, omit it or return kind=unknown with uncertainty. Return one JSON object with exactly these root fields: outline_xy (flat numeric coordinate pairs), outline_confidence (number 0..1), outline_uncertainty (array of strings), and candidates (array). Each candidate must contain kind (room, wall, door, opening, corridor, stairs, exit, or unknown), polygon_xy (flat numeric coordinate pairs), label (string), explicitly_marked_exit (boolean), confidence (geometry confidence 0..1), label_confidence (readability confidence 0..1), uncertainty (array of strings), and label_is_readable (boolean). Use an empty string and label_confidence 0 for an unreadable label. An exit candidate must have explicitly_marked_exit true and a readable verbatim label. Encode each polygon as [x1,y1,x2,y2,...]; coordinates must be normalized 0..1 in THIS image/tile, origin at top left, and be even-length x/y pairs with at least three distinct non-collinear points. Add uncertainty whenever a feature boundary or text is unclear. These are unverified candidates requiring human review; never claim a path is safe."""

MODEL_DEFAULT = "gemini-3.8-flash"
TILE_EDGE = 2048
TILE_OVERLAP = 256
logger = logging.getLogger("exodus.gemini")
MAX_ATTEMPTS = 3
REQUEST_TIMEOUT_MS = 90_000
MAX_ANALYSIS_SECONDS = 180


def _http_status(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    return getattr(exc, "code", None) or getattr(exc, "status_code", None) or getattr(response, "status_code", None)


def _retry_after(exc: Exception) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", {}) or {}
    value = headers.get("Retry-After") or headers.get("retry-after")
    if value:
        try:
            return max(0.0, min(30.0, float(value)))
        except (TypeError, ValueError):
            try:
                when = parsedate_to_datetime(value)
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
                return max(0.0, min(30.0, (when - datetime.now(timezone.utc)).total_seconds()))
            except (TypeError, ValueError, OverflowError):
                pass
    details = getattr(exc, "details", {}) or {}
    if isinstance(details, dict):
        error_details = details.get("error", details).get("details", []) if isinstance(details.get("error", details), dict) else []
        for item in error_details:
            if not isinstance(item, dict) or not str(item.get("@type", "")).endswith("RetryInfo"):
                continue
            match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)s\s*", str(item.get("retryDelay", "")))
            if match:
                return max(0.0, min(30.0, float(match.group(1))))
    return None


def _is_quota_exhausted(exc: Exception) -> bool:
    details = getattr(exc, "details", {}) or {}
    message = str(getattr(exc, "message", ""))
    if isinstance(details, dict):
        message += " " + str(details)
    message = message.lower()
    return _http_status(exc) == 429 and any(term in message for term in (
        "quota", "billing", "free_tier_requests", "perdayperproject", "quotafailure",
    ))


def _gemini_error(exc: Exception) -> GeminiAnalysisError:
    status = _http_status(exc)
    payload = getattr(exc, "details", {}) or {}
    raw_message = getattr(exc, "message", None) or (payload.get("error", {}).get("message", "") if isinstance(payload, dict) else "")
    message = str(raw_message).lower()
    safe_message = str(raw_message)[:500]
    secret = os.environ.get("GEMINI_API_KEY", "").strip()
    if secret:
        safe_message = safe_message.replace(secret, "[redacted]")
    logger.warning("Gemini API failure status=%s code=%s message=%s", status, getattr(exc, "status", None), safe_message)
    if status in (401, 403) or "api key not valid" in message or "api_key_invalid" in message:
        return GeminiAnalysisError("Gemini authentication failed. Check GEMINI_API_KEY and its API access in the backend environment.", 502)
    if status == 429:
        if _is_quota_exhausted(exc):
            return GeminiAnalysisError("Gemini quota is exhausted. Check the project quota or billing, then retry.", 429)
        return GeminiAnalysisError("Gemini rate limit reached. Wait briefly or check the project rate limits, then retry.", 429)
    if status in (404,) or (status == 400 and ("model" in message or "unsupported" in message)):
        return GeminiAnalysisError("The configured Gemini model is unavailable. Set GEMINI_MODEL to a supported vision model.", 502)
    if status == 503:
        return GeminiAnalysisError("Gemini is temporarily overloaded after bounded retries. Retry the analysis in a few moments.", 503)
    if status in (408, 504) or isinstance(exc, TimeoutError):
        return GeminiAnalysisError("Gemini analysis timed out after bounded retries. Retry with a stable connection.", 504)
    if status == 400:
        return GeminiAnalysisError("Gemini rejected the analysis request. Check the configured model and request format.", 502)
    return GeminiAnalysisError("Gemini analysis failed. Check backend logs for the API status, then retry.", 502)


def _tiles(image: np.ndarray, edge: int = TILE_EDGE, overlap: int = TILE_OVERLAP):
    height, width = image.shape[:2]
    if max(width, height) <= edge:
        yield image, (0, 0, width, height)
        return
    step = edge - overlap
    def starts(length: int) -> list[int]:
        result = [0]
        while result[-1] + edge < length:
            result.append(result[-1] + step)
        return result

    xs = starts(width)
    ys = starts(height)
    for y in ys:
        for x in xs:
            tile = image[y:min(y + edge, height), x:min(x + edge, width)]
            yield tile, (x, y, tile.shape[1], tile.shape[0])


def _client_call(image: np.ndarray, model: str, client=None, deadline: float | None = None) -> VisionResponse:
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if client is None and not api_key:
        raise GeminiAnalysisError("Gemini analysis is unavailable: set GEMINI_API_KEY in the backend environment.", 503)

    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise GeminiAnalysisError("Could not encode the original plan image for Gemini.")
    part = types.Part.from_bytes(data=encoded.tobytes(), mime_type="image/png")
    for attempt in range(MAX_ATTEMPTS):
        remaining = (deadline - time.monotonic()) if deadline is not None else MAX_ANALYSIS_SECONDS
        if remaining <= 0:
            raise GeminiAnalysisError("Gemini floor-plan analysis exceeded its 180-second time limit. Retry the analysis.", 504)
        try:
            request_client = client
            if request_client is None:
                from google import genai
                request_timeout = max(1, min(REQUEST_TIMEOUT_MS, int(remaining * 1000)))
                request_client = genai.Client(api_key=api_key, http_options=types.HttpOptions(
                    timeout=request_timeout,
                    retry_options=types.HttpRetryOptions(attempts=1),
                ))
            response = request_client.models.generate_content(
                model=model,
                contents=[PROMPT, part],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            break
        except Exception as exc:
            status = _http_status(exc)
            transient = status in (408, 429, 500, 502, 503, 504) or isinstance(exc, (TimeoutError, ConnectionError)) or type(exc).__name__ in {"TimeoutException", "ConnectError"}
            # A quota exhaustion is a permanent project/account condition for
            # this request window. Retrying it only burns more request slots.
            if not transient or _is_quota_exhausted(exc):
                raise _gemini_error(exc) from exc
            if attempt + 1 >= MAX_ATTEMPTS:
                raise _gemini_error(exc) from exc
            delay = _retry_after(exc)
            if delay is None:
                delay = min(8.0, 0.5 * (2 ** attempt)) + random.uniform(0.0, 0.25)
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise GeminiAnalysisError("Gemini floor-plan analysis exceeded its 180-second time limit. Retry the analysis.", 504) from exc
                delay = min(delay, remaining)
            logger.info("Retrying Gemini request after transient status=%s attempt=%s/%s delay=%.2fs", status, attempt + 2, MAX_ATTEMPTS, delay)
            time.sleep(delay)
    try:
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, VisionResponse):
            return parsed
        text = getattr(response, "text", None)
        if not text:
            raise ValueError("Gemini returned an empty response")
        return VisionResponse.model_validate_json(text)
    except (ValidationError, ValueError, TypeError) as exc:
        raise GeminiAnalysisError("Gemini returned invalid floor-plan JSON; no detections were saved.", 502) from exc


def _map_point(point: Point, tile: tuple[int, int, int, int], full_size: tuple[int, int]) -> dict:
    x0, y0, tw, th = tile
    width, height = full_size
    return {"x": (x0 + point.x * tw) / width, "y": (y0 + point.y * th) / height}


def _inside_outline(polygon: list[dict], outline: list[dict]) -> bool:
    if len(outline) < 3:
        return True
    center = np.mean([[point["x"], point["y"]] for point in polygon], axis=0)
    contour = np.array([[[point["x"], point["y"]] for point in outline]], dtype=np.float32)
    return cv2.pointPolygonTest(contour, (float(center[0]), float(center[1])), False) >= 0


def _polygon_bbox_iou(first: list[dict], second: list[dict]) -> float:
    ax = [point["x"] for point in first]
    ay = [point["y"] for point in first]
    bx = [point["x"] for point in second]
    by = [point["y"] for point in second]
    left, top = max(min(ax), min(bx)), max(min(ay), min(by))
    right, bottom = min(max(ax), max(bx)), min(max(ay), max(by))
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    area_a = max(0.0, max(ax) - min(ax)) * max(0.0, max(ay) - min(ay))
    area_b = max(0.0, max(bx) - min(bx)) * max(0.0, max(by) - min(by))
    union = area_a + area_b - intersection
    return intersection / union if union else 0.0


def analyze_image(image: np.ndarray, client=None, model: str | None = None) -> dict:
    """Use original pixels (overlapping 2048px tiles for large uploads)."""
    model = model or os.environ.get("GEMINI_MODEL", MODEL_DEFAULT)
    deadline = time.monotonic() + MAX_ANALYSIS_SECONDS
    height, width = image.shape[:2]
    width_height = (width, height)
    mapped_outline: list[dict] = []
    outline_confidence = 0.0
    outline_uncertainty: list[str] = []
    candidates: list[dict] = []
    all_warnings: list[str] = []
    tile_list = list(_tiles(image))
    # For large plans, ask once on a whole-page overview for global extent,
    # then process overlapping original-resolution tiles for local details.
    if len(tile_list) > 1:
        scale = min(1.0, TILE_EDGE / max(width, height))
        overview = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        overview_result = _client_call(overview, model, client, deadline)
        mapped_outline = [_map_point(point, (0, 0, width, height), width_height) for point in overview_result.outline]
        outline_confidence = overview_result.outline_confidence
        outline_uncertainty.extend(overview_result.outline_uncertainty)
        all_warnings.extend(overview_result.outline_uncertainty)
        detail_tiles = tile_list
    else:
        detail_tiles = tile_list
    for tile_image, tile_box in detail_tiles:
        result = _client_call(tile_image, model, client, deadline)
        if not mapped_outline and result.outline:
            mapped_outline = [_map_point(point, tile_box, width_height) for point in result.outline]
            outline_confidence = result.outline_confidence
            outline_uncertainty.extend(result.outline_uncertainty)
            all_warnings.extend(result.outline_uncertainty)
        for index, item in enumerate(result.candidates):
            # Semantic claims remain candidates. Exit candidates must be
            # explicitly marked as exits, never inferred from geometry.
            if item.kind == "exit" and not item.explicitly_marked_exit:
                kind = "unknown"
                all_warnings.append("An exit-like feature was not explicitly marked and was not reported as an exit.")
            else:
                kind = item.kind
            polygon = [_map_point(point, tile_box, width_height) for point in item.polygon]
            if any(not (0 <= p["x"] <= 1 and 0 <= p["y"] <= 1) for p in polygon):
                raise GeminiAnalysisError("Gemini returned coordinates outside the original source image.")
            if outline_confidence >= .55 and not _inside_outline(polygon, mapped_outline):
                continue
            candidates.append({
                "id": f"gemini-{tile_box[0]}-{tile_box[1]}-{index + 1}",
                "kind": kind,
                "label": item.label if item.label_is_readable else None,
                "label_is_readable": item.label_is_readable,
                "polygon": polygon,
                "confidence": item.confidence,
                "label_confidence": item.label_confidence,
                "uncertainty": item.uncertainty,
                "review_status": "candidate",
            })
            if item.confidence < .45:
                all_warnings.append(f"Low geometry confidence for {kind} candidate {item.label or item.kind}; manual review is especially important.")
            if item.label_is_readable and item.label_confidence < .55:
                all_warnings.append(f"Low label confidence for candidate {item.label}; verify the transcription against the source.")
    if len(tile_list) > 1:
        # Merge only near-identical same-kind polygons in tile overlaps.
        # Nearby adjacent rooms with merely similar centers remain separate.
        merged: list[dict] = []
        for item in candidates:
            duplicate = next((old for old in merged if old["kind"] == item["kind"] and old.get("label") == item.get("label") and _polygon_bbox_iou(item["polygon"], old["polygon"]) >= .75), None)
            if duplicate is None:
                merged.append(item)
            elif item["confidence"] > duplicate["confidence"]:
                merged[merged.index(duplicate)] = item
        candidates = merged
    if not mapped_outline:
        missing_outline_warning = "The full plan outline could not be confidently identified; the plan region requires manual review."
        all_warnings.append(missing_outline_warning)
        outline_uncertainty.append(missing_outline_warning)
    all_warnings.extend(["AI detections are candidates and require human review.", "Evacuation geometry and exits are not validated; no route is claimed safe."])
    return {
        "model": model,
            "outline": mapped_outline,
        "outline_confidence": outline_confidence if mapped_outline else 0.0,
        "outline_uncertainty": list(dict.fromkeys(outline_uncertainty)),
        "candidates": candidates,
        "geometric_candidates": [],
        "outer_walls": [], "rooms": [], "corridors": [], "doors": [], "openings": [], "stairs": [], "exits": [],
        "elements": [],
        "warnings": list(dict.fromkeys(all_warnings)),
    }


def render_detection_overlay(image: np.ndarray, analysis: dict) -> np.ndarray:
    """Raster overlay helper used to verify normalized source-image mapping."""
    output = image.copy()
    height, width = output.shape[:2]
    outline = analysis.get("outline", [])
    if len(outline) >= 3:
        points = np.array([[(round(point["x"] * (width - 1)), round(point["y"] * (height - 1))) for point in outline]], dtype=np.int32)
        cv2.polylines(output, points, True, (30, 180, 110), 3, cv2.LINE_AA)
    for candidate in analysis.get("candidates", []):
        polygon = candidate.get("polygon", [])
        if len(polygon) >= 3:
            points = np.array([[(round(point["x"] * (width - 1)), round(point["y"] * (height - 1))) for point in polygon]], dtype=np.int32)
            cv2.polylines(output, points, True, (220, 120, 30), 2, cv2.LINE_AA)
    return output
