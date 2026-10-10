from pydantic import BaseModel, Field, field_validator


class SimulationRequest(BaseModel):
    incident_type: str = Field(min_length=1, max_length=80, examples=["fire"])
    floor: int = Field(ge=1, le=200, examples=[4])
    occupant_count: int = Field(ge=0, le=100_000, examples=[36])
    fire_location: str = Field(min_length=1, max_length=120, examples=["East breakout room"])

    @field_validator("incident_type", "fire_location")
    @classmethod
    def trim_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ZoneResult(BaseModel):
    zone: str
    estimated_occupants: int
    status: str
    risk_level: str


class SimulationResponse(BaseModel):
    evacuation_time_seconds: int
    people_saved: int
    people_trapped: int
    congestion_zones: list[str]
    safe_exits: list[str]
    zones: list[ZoneResult]
    risk_score: int = Field(ge=0, le=100)
