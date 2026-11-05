"""Facts that timeline validation needs from project media."""

from dataclasses import dataclass


@dataclass(frozen=True)
class TimelineAsset:
    kind: str
    processing_status: str
    duration_us: int
    fingerprint: str
    revision: int

    @classmethod
    def from_metadata(cls, kind, metadata):
        return cls(
            kind=kind,
            processing_status=metadata.processing_status,
            duration_us=int((metadata.probe or {}).get("durationUs") or 0),
            fingerprint=metadata.fingerprint,
            revision=metadata.revision,
        )
