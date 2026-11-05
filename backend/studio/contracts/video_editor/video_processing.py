"""Private scope for deriving a Video Editor project's exact original."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.asset_library.descriptions import ID
from studio.runtime.messaging.timed_peer import TimedPeer

JOBS = "/_internal/v1/video-media-jobs"
ORIGINALS = "/_internal/v1/video-media-originals"
VARIANTS = ("proxy", "thumbnail", "waveform")
AssetKind = Literal["video", "audio", "image", "font"]


def valid_id(identity):
    return isinstance(identity, str) and re.fullmatch(ID, identity) is not None


class MediaJobIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: str = Field(pattern="^" + ID + "$")
    asset_id: str = Field(pattern="^" + ID + "$")


class MediaOriginal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: AssetKind
    byte_size: int = Field(gt=0, strict=True)


class MediaJobOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    probe: dict
    fingerprint: str = Field(pattern=r"^([a-f0-9]{64})?$")
    proxy: str | None = None
    thumbnail: str | None = None
    waveform: str | None = None
    error: str | None = None


def video_peer(secret):
    return TimedPeer(secret, domain=b"fpl-video-render-jobs-v1")


def originals_peer(secret):
    return TimedPeer(secret, domain=b"fpl-video-render-originals-v1")
