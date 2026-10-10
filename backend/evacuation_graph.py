from __future__ import annotations

import heapq
import math
from copy import deepcopy


def _center(node: dict) -> tuple[float, float]:
    box = node.get("bbox", {})
    return box.get("x", 0) + box.get("width", 0) / 2, box.get("y", 0) + box.get("height", 0) / 2


def _distance(a: dict, b: dict) -> float:
    ax, ay = _center(a)
    bx, by = _center(b)
    return math.hypot(ax - bx, ay - by)


GRAPH_VERSION = 3


def _geometry_box(item: dict) -> dict | None:
    box = item.get("bbox")
    if not box and item.get("polygon"):
        points = item["polygon"]
        xs = [point["x"] for point in points]
        ys = [point["y"] for point in points]
        box = {"x": min(xs), "y": min(ys), "width": max(xs) - min(xs), "height": max(ys) - min(ys)}
    if not isinstance(box, dict):
        return None
    try:
        x, y, width, height = (float(box[key]) for key in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError):
        return None
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > 1 or y + height > 1:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _box_gap(first: dict, second: dict) -> float:
    ax, ay, aw, ah = (first[key] for key in ("x", "y", "width", "height"))
    bx, by, bw, bh = (second[key] for key in ("x", "y", "width", "height"))
    gap_x = max(ax - bx - bw, bx - ax - aw, 0)
    gap_y = max(ay - by - bh, by - ay - ah, 0)
    return math.hypot(gap_x, gap_y)


def _intersection_area(first: dict, second: dict) -> float:
    left = max(first["x"], second["x"])
    top = max(first["y"], second["y"])
    right = min(first["x"] + first["width"], second["x"] + second["width"])
    bottom = min(first["y"] + first["height"], second["y"] + second["height"])
    return max(0.0, right - left) * max(0.0, bottom - top)


def _geometric_contact(first: dict, second: dict) -> bool:
    if _intersection_area(first, second) > 1e-12:
        return True
    overlap_x = min(first["x"] + first["width"], second["x"] + second["width"]) - max(first["x"], second["x"])
    overlap_y = min(first["y"] + first["height"], second["y"] + second["height"]) - max(first["y"], second["y"])
    shared_vertical_edge = min(abs(first["x"] + first["width"] - second["x"]), abs(second["x"] + second["width"] - first["x"])) <= 1e-7
    shared_horizontal_edge = min(abs(first["y"] + first["height"] - second["y"]), abs(second["y"] + second["height"] - first["y"])) <= 1e-7
    return (shared_vertical_edge and overlap_y > 1e-7) or (shared_horizontal_edge and overlap_x > 1e-7)


def passage_connections(analysis: dict, passage: dict) -> dict:
    """Resolve one reviewed passage against geometry, without nearest-area guessing."""
    box = _geometry_box(passage)
    if box is None:
        return {"valid": False, "connected_regions": [], "reason": "Passage has missing, zero-area, or out-of-bounds geometry."}
    regions = []
    for kind, collection in (("room", "rooms"), ("corridor", "corridors"), ("stairs", "stairs"), ("exit", "exits")):
        for item in analysis.get(collection, []):
            if item.get("review_status") != "confirmed":
                continue
            region_box = _geometry_box(item)
            if region_box is None:
                continue
            # Positive intersection is the primary geometric test. A shared
            # boundary is also a valid contact when the drawn passage ends on it.
            if _geometric_contact(box, region_box):
                regions.append({"id": item["id"], "label": (item.get("label") or "").strip(), "type": kind})
    if len(regions) != 2:
        names = ", ".join(region["label"] or region["id"] for region in regions) or "none"
        reason = f"Passage geometry intersects {len(regions)} navigable regions ({names}); exactly two are required."
        return {"valid": False, "connected_regions": regions, "reason": reason}
    exits = [region for region in regions if region["type"] == "exit"]
    if exits and any(not region["label"] for region in exits):
        return {"valid": False, "connected_regions": regions, "reason": "An exit connection requires the explicit exit label from the plan."}
    return {"valid": True, "connected_regions": regions, "reason": None}


def build_graph(analysis: dict) -> dict:
    nodes: list[dict] = []
    excluded: list[dict] = []
    for kind, collection in (("room", "rooms"), ("corridor", "corridors"), ("door", "doors"), ("opening", "openings"), ("stairs", "stairs"), ("exit", "exits")):
        for item in analysis.get(collection, []):
            if item.get("review_status") != "confirmed":
                excluded.append({"id": item.get("id"), "type": kind, "reason": "not human-reviewed"})
                continue
            box = _geometry_box(item)
            if box is None:
                excluded.append({"id": item.get("id"), "type": kind, "reason": "missing or out-of-bounds geometry"})
                continue
            label = (item.get("label") or "").strip()
            if kind == "exit" and not label:
                excluded.append({"id": item.get("id"), "type": kind, "reason": "exit has no explicit label"})
                continue
            node = {"id": item["id"], "type": kind, "label": label or item["id"], "bbox": box, "confidence": item.get("confidence", .35), "status": "unverified"}
            nodes.append(node)

    areas = [node for node in nodes if node["type"] in {"room", "corridor", "stairs"}]
    connectors = [node for node in nodes if node["type"] in {"door", "opening"}]
    exits = [node for node in nodes if node["type"] == "exit"]
    edges: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def connect(first: dict, second: dict, confidence: float, relation: str) -> None:
        if first["id"] == second["id"]: return
        key = tuple(sorted((first["id"], second["id"])))
        if key in seen: return
        seen.add(key)
        edges.append({"from": key[0], "to": key[1], "length": round(max(.002, _distance(first, second)), 5), "confidence": round(confidence, 2), "relation": relation, "blocked": False})

    # Only a reviewed door/opening whose box physically touches exactly two
    # navigable regions establishes a local passage. Proximity and area-area
    # overlap alone never produce a connection.
    dangling_connectors: list[str] = []
    rejected_passages: list[dict] = []
    passage_region_pairs: set[tuple[str, str]] = set()
    for connector in connectors:
        resolution = passage_connections(analysis, connector)
        attached_ids = {region["id"] for region in resolution["connected_regions"]}
        attached = [node for node in [*areas, *exits] if node["id"] in attached_ids]
        if not resolution["valid"]:
            dangling_connectors.append(connector["id"])
            rejected_passages.append({"id": connector["id"], "label": connector["label"], "reason": resolution["reason"]})
            continue
        relation = "reviewed-door-contact" if connector["type"] == "door" else "reviewed-opening-contact"
        passage_region_pairs.add(tuple(sorted(node["id"] for node in attached)))
        for area in attached:
            connect(connector, area, min(connector["confidence"], area["confidence"]), relation)

    # A labeled exit connects only through an explicitly reviewed connector or
    # by geometrically touching one corridor/stair area. Nearest-neighbor links
    # are intentionally disallowed.
    unconnected_exits: list[str] = []
    for exit_node in exits:
        touching_connectors = [node for node in connectors if tuple(sorted((node["id"], exit_node["id"]))) in seen]
        if len(touching_connectors) == 1:
            connector = touching_connectors[0]
            connect(exit_node, connector, min(exit_node["confidence"], connector["confidence"]), "labeled-exit-through-connector")
            continue
        touching_areas = [node for node in areas if node["type"] in {"corridor", "stairs"} and _geometric_contact(exit_node["bbox"], node["bbox"])]
        if len(touching_connectors) == 0 and len(touching_areas) == 1:
            area = touching_areas[0]
            connect(exit_node, area, min(exit_node["confidence"], area["confidence"]), "labeled-exit-boundary-contact")
        else:
            unconnected_exits.append(exit_node["id"])

    adjacency = {node["id"]: [] for node in nodes}
    for edge in edges:
        adjacency[edge["from"]].append(edge["to"])
        adjacency[edge["to"]].append(edge["from"])
    graph = {"version": GRAPH_VERSION, "nodes": nodes, "edges": edges, "adjacency": adjacency}
    graph["diagnostics"] = graph_diagnostics(graph, excluded, dangling_connectors, unconnected_exits)
    graph["diagnostics"]["invalid_passages"] = rejected_passages
    possible_pairs = []
    for first in nodes:
        for second in nodes:
            if first["id"] >= second["id"]:
                continue
            supported = (first["type"] == "room" and second["type"] == "corridor") or (second["type"] == "room" and first["type"] == "corridor") or (first["type"] == second["type"] == "corridor") or ({first["type"], second["type"]} == {"corridor", "stairs"}) or ({first["type"], second["type"]} == {"stairs", "exit"}) or ({first["type"], second["type"]} == {"corridor", "exit"})
            if not supported or first["type"] in {"door", "opening"} or second["type"] in {"door", "opening"}:
                continue
            pair = tuple(sorted((first["id"], second["id"])))
            if pair in passage_region_pairs or pair in seen:
                continue
            gap = _box_gap(first["bbox"], second["bbox"])
            if gap <= .025:
                possible_pairs.append({"from_id": first["id"], "from_label": first["label"], "to_id": second["id"], "to_label": second["label"], "bbox_gap": round(gap, 5), "reason": "No reviewed passage connects these nearby regions. Inspect the original plan and draw a door/opening only if one is shown."})
    graph["diagnostics"]["missing_passage_connections"] = sorted(possible_pairs, key=lambda item: (item["bbox_gap"], item["from_label"], item["to_label"]))
    return graph


def graph_diagnostics(graph: dict, excluded: list[dict] | None = None, dangling_connectors: list[str] | None = None, unconnected_exits: list[str] | None = None) -> dict:
    nodes = {node["id"]: node for node in graph["nodes"]}
    room_routes = []
    unreachable_rooms = []
    reached_exit_ids: set[str] = set()
    for node in graph["nodes"]:
        if node["type"] != "room":
            continue
        routes = route_summary(graph, node["id"])
        if routes["nearest_exit"] is None:
            unreachable_rooms.append({"id": node["id"], "label": node["label"]})
        else:
            reached_exit_ids.update(route["exit_id"] for route in [routes["nearest_exit"], *routes["alternate_exits"]])
        room_routes.append({"room_id": node["id"], "room_label": node["label"], "nearest_exit": routes["nearest_exit"], "alternate_exits": routes["alternate_exits"]})
    disconnected_nodes = [
        {"id": node["id"], "type": node["type"], "label": node["label"]}
        for node in graph["nodes"] if not graph["adjacency"].get(node["id"])
    ]
    passage_neighbor_ids = {edge["from"] for edge in graph["edges"] if nodes[edge["from"]]["type"] in {"door", "opening"}} | {edge["to"] for edge in graph["edges"] if nodes[edge["to"]]["type"] in {"door", "opening"}}
    rooms_without_passages = [
        {"id": node["id"], "label": node["label"]}
        for node in graph["nodes"] if node["type"] == "room" and node["id"] not in passage_neighbor_ids
    ]
    labelled_exits = [node for node in graph["nodes"] if node["type"] == "exit" and node["label"].strip()]
    unreachable_exits = [{"id": node["id"], "label": node["label"]} for node in labelled_exits if node["id"] not in reached_exit_ids]
    components = []
    seen: set[str] = set()
    for start in graph["adjacency"]:
        if start in seen:
            continue
        pending = [start]
        seen.add(start)
        component = []
        while pending:
            current = pending.pop()
            component.append(current)
            for neighbor in graph["adjacency"].get(current, []):
                if neighbor not in seen:
                    seen.add(neighbor)
                    pending.append(neighbor)
        components.append(component)
    return {
        "node_count": len(nodes),
        "edge_count": len(graph["edges"]),
        "unreachable_rooms": unreachable_rooms,
        "disconnected_nodes": disconnected_nodes,
        "unreachable_exits": unreachable_exits,
        "routes_to_labelled_exits": room_routes,
        "excluded_elements": excluded or [],
        "dangling_connectors": dangling_connectors or [],
        "unconnected_exits": unconnected_exits or [],
        "connected_components": components,
        "component_count": len(components),
        "rooms_without_passages": rooms_without_passages,
        "invalid_passages": [],
        "missing_passage_connections": [],
        "path_length_units": "normalized source-image coordinates",
        "safety_claim": False,
        "warnings": ["A graph path indicates reviewed geometric connectivity only; it does not establish route safety, accessibility, capacity, or code compliance.", "This graph covers one reviewed page. Stair nodes do not connect floors without a separately verified cross-floor stair match."],
    }


def _shortest(graph: dict, start_id: str, exit_id: str | None = None) -> tuple[list[str], float] | None:
    node_map = {node["id"]: node for node in graph["nodes"]}
    if start_id not in node_map: return None
    distances = {start_id: 0.0}
    previous: dict[str, str] = {}
    queue = [(0.0, start_id)]
    edges = graph["edges"]
    while queue:
        distance, current = heapq.heappop(queue)
        if distance != distances.get(current): continue
        if current == exit_id: break
        for edge in edges:
            first, second = edge.get("from"), edge.get("to")
            try:
                length = float(edge.get("length"))
            except (TypeError, ValueError):
                continue
            if first not in node_map or second not in node_map or first == second or not math.isfinite(length) or length <= 0:
                continue
            if edge.get("blocked") or first != current and second != current: continue
            neighbor = second if first == current else first
            if node_map[neighbor]["status"] in {"dangerous", "blocked"}: continue
            next_distance = distance + length
            if next_distance < distances.get(neighbor, float("inf")):
                distances[neighbor] = next_distance
                previous[neighbor] = current
                heapq.heappush(queue, (next_distance, neighbor))
    if exit_id is None:
        reachable = [node_id for node_id, node in node_map.items() if node["type"] == "exit" and node_id in distances]
        if not reachable: return None
        exit_id = min(reachable, key=lambda node_id: distances[node_id])
    if exit_id not in distances: return None
    path = [exit_id]
    while path[-1] != start_id: path.append(previous[path[-1]])
    path.reverse()
    return path, distances[exit_id]


def route_summary(graph: dict, start_id: str) -> dict:
    nodes = {node["id"]: node for node in graph["nodes"]}
    if start_id not in nodes: return {"start_node_id": start_id, "nearest_exit": None, "alternate_exits": [], "blocked_paths": [], "path_length": None}
    routes = []
    for node in graph["nodes"]:
        if node["type"] != "exit": continue
        found = _shortest(graph, start_id, node["id"])
        if found:
            path, length = found
            routes.append({"exit_id": node["id"], "exit_label": node["label"], "path_node_ids": path, "path_length": round(length, 5)})
    routes.sort(key=lambda route: (route["path_length"], route["exit_label"].casefold(), route["exit_id"]))
    blocked_exits = [node["id"] for node in graph["nodes"] if node["type"] == "exit" and not any(route["exit_id"] == node["id"] for route in routes)]
    nearest = routes[0] if routes else None
    blocked_edges = [{"from": edge["from"], "to": edge["to"], "risk": edge.get("risk", 0)} for edge in graph["edges"] if edge.get("blocked")]
    return {
        "start_node_id": start_id,
        "nearest_exit": nearest,
        "alternate_exits": routes[1:],
        "blocked_paths": blocked_exits,
        "blocked_edges": blocked_edges,
        "path_length": nearest["path_length"] if nearest else None,
    }


def propagate_fire(graph: dict, fire_node_id: str, elapsed_seconds: float, intensity: float = 1.0, smoke_density: float = 1.0) -> dict:
    updated = deepcopy(graph)
    node_map = {node["id"]: node for node in updated["nodes"]}
    if fire_node_id not in node_map: raise ValueError("Fire location must be a node in this floor graph.")
    source = node_map[fire_node_id]
    distances = {fire_node_id: 0.0}
    queue = [(0.0, fire_node_id)]
    while queue:
        distance, current = heapq.heappop(queue)
        if distance != distances.get(current): continue
        for edge in updated["edges"]:
            neighbor = edge["to"] if edge["from"] == current else edge["from"] if edge["to"] == current else None
            if neighbor is None: continue
            next_distance = distance + edge["length"]
            if next_distance < distances.get(neighbor, float("inf")):
                distances[neighbor] = next_distance
                heapq.heappush(queue, (next_distance, neighbor))

    for node in updated["nodes"]:
        distance = distances.get(node["id"], float("inf"))
        smoke_arrival = distance * 180 / max(.2, smoke_density)
        fire_arrival = distance * 340 / max(.2, intensity)
        smoke = 0.0 if elapsed_seconds < smoke_arrival else min(1.0, (elapsed_seconds - smoke_arrival) / 45)
        fire = 0.0 if elapsed_seconds < fire_arrival else min(1.0, (elapsed_seconds - fire_arrival) / 55)
        if node["id"] == fire_node_id:
            # The slider's zero position and Reset mean no elapsed exposure.
            # Do not leave the ignition node blocked at t=0, or a reset can
            # never restore routes through the selected starting room.
            fire = min(1.0, .35 + elapsed_seconds / 80) if elapsed_seconds > 0 else 0.0
            smoke = min(1.0, .2 + elapsed_seconds / 90) if elapsed_seconds > 0 else 0.0
        risk = max(smoke, fire)
        status = "blocked" if fire >= .35 or smoke >= .92 else "dangerous" if risk >= .62 else "warning" if risk >= .18 else "safe"
        node.update({"status": status, "smoke_level": round(smoke, 3), "fire_level": round(fire, 3), "risk": round(risk, 3), "distance_from_fire": round(distance, 5) if math.isfinite(distance) else None})
    for edge in updated["edges"]:
        first, second = node_map[edge["from"]], node_map[edge["to"]]
        edge["blocked"] = first["status"] in {"dangerous", "blocked"} or second["status"] in {"dangerous", "blocked"}
        edge["risk"] = max(first["risk"], second["risk"])
    updated["fire"] = {"node_id": fire_node_id, "elapsed_seconds": elapsed_seconds, "intensity": intensity, "smoke_density": smoke_density}
    return updated


def evacuation_routes(graph: dict, start_id: str) -> dict:
    return route_summary(graph, start_id)
