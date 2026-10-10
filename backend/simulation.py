from math import ceil

from schemas import SimulationRequest, SimulationResponse, ZoneResult

# Heuristic inputs for the mock model: severity, clearance-time multiplier.
INCIDENT_PROFILES: dict[str, tuple[float, float]] = {
    "fire": (0.72, 1.34),
    "kitchen fire": (0.72, 1.34),
    "smoke": (0.65, 1.29),
    "smoke in corridor": (0.65, 1.29),
    "gas leak": (0.82, 1.22),
    "electrical fire": (0.78, 1.38),
    "explosion": (0.95, 1.48),
    "medical emergency": (0.32, 1.08),
}

ZONE_SHARES = (0.18, 0.25, 0.16, 0.16, 0.25)


def _risk_level(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= 55:
        return "high"
    if score >= 30:
        return "moderate"
    return "low"


def _split_occupants(total: int, shares: tuple[float, ...]) -> list[int]:
    allocated = [round(total * share) for share in shares[:-1]]
    allocated.append(max(0, total - sum(allocated)))
    # Rounding the first zones can exceed a very small total; keep the split exact.
    for index in range(len(allocated) - 1):
        if sum(allocated) > total and allocated[index] > 0:
            allocated[index] -= 1
    return allocated


def simulate(request: SimulationRequest) -> SimulationResponse:
    incident_key = request.incident_type.casefold().strip()
    severity, incident_time_multiplier = INCIDENT_PROFILES.get(incident_key, (0.60, 1.25))
    location_key = request.fire_location.casefold()
    is_chokepoint = any(word in location_key for word in ("corridor", "stair", "exit", "lobby"))

    # Clearance time grows with occupant load, vertical travel, incident severity,
    # and additional route friction around a chokepoint.
    base_seconds = 75 + request.occupant_count * 4.2
    floor_multiplier = 1 + min(request.floor - 1, 40) * 0.018
    load_multiplier = 1 + min(max(request.occupant_count - 40, 0) / 500, 0.15)
    location_multiplier = 1.12 if is_chokepoint else 1.0
    evacuation_time = ceil(
        base_seconds
        * floor_multiplier
        * load_multiplier
        * incident_time_multiplier
        * location_multiplier
    )

    # Approximate the share exposed to serious danger. The number is clamped so
    # this mock model never reports more trapped people than occupants.
    trapped_rate = (
        severity * 0.012
        + max(request.floor - 1, 0) * 0.001
        + max(request.occupant_count - 50, 0) * 0.0005
        + (0.004 if is_chokepoint else 0)
    )
    people_trapped = min(
        request.occupant_count,
        ceil(request.occupant_count * min(trapped_rate, 0.30)),
    ) if request.occupant_count else 0
    people_saved = request.occupant_count - people_trapped

    raw_risk = (
        28
        + severity * 43
        + min(request.floor, 20) * 0.7
        + min(request.occupant_count, 250) * 0.045
        + (8 if is_chokepoint else 0)
        + (people_trapped / max(request.occupant_count, 1)) * 100
    )
    risk_score = max(0, min(100, round(raw_risk)))

    congestion_zones: list[str] = []
    if request.occupant_count >= 20:
        congestion_zones.append("Central corridor")
    if request.occupant_count >= 45:
        congestion_zones.extend(("East stairwell", "West stairwell"))
    if is_chokepoint and request.fire_location not in congestion_zones:
        congestion_zones.insert(0, request.fire_location)

    safe_exits = ["Stairwell A", "Stairwell B"]
    if any(token in location_key for token in ("stairwell a", "stair a", "west exit", "west stairwell")):
        safe_exits = ["Stairwell B"]
    elif any(token in location_key for token in ("stairwell b", "stair b", "east exit", "east stairwell")):
        safe_exits = ["Stairwell A"]

    zone_names = list(dict.fromkeys([
        request.fire_location,
        "Central corridor",
        "East stairwell",
        "West stairwell",
        "Office area",
    ]))
    zone_weights = ZONE_SHARES[:len(zone_names)]
    weight_total = sum(zone_weights)
    zone_shares = tuple(weight / weight_total for weight in zone_weights)
    zone_occupants = _split_occupants(request.occupant_count, zone_shares)
    zones: list[ZoneResult] = []
    overall_risk = _risk_level(risk_score)
    for name, count in zip(zone_names, zone_occupants, strict=True):
        if name.casefold() == location_key:
            status = "hazard"
            zone_risk = "critical" if severity >= 0.7 else "high"
        elif name in congestion_zones:
            status = "congested"
            zone_risk = "high" if count >= 15 else "moderate"
        else:
            status = "clear"
            zone_risk = "moderate" if overall_risk in ("high", "critical") and count else "low"
        zones.append(
            ZoneResult(
                zone=name,
                estimated_occupants=count,
                status=status,
                risk_level=zone_risk,
            )
        )

    return SimulationResponse(
        evacuation_time_seconds=evacuation_time,
        people_saved=people_saved,
        people_trapped=people_trapped,
        congestion_zones=congestion_zones,
        safe_exits=safe_exits,
        zones=zones,
        risk_score=risk_score,
    )
