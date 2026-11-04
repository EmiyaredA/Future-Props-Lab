"""Video Editor's durable cross-service outcomes."""

from sqlalchemy.orm import DeclarativeBase

from fpl_runtime.reference_records import ReferenceMutationFields


class VideoServiceBase(DeclarativeBase):
    pass


class VideoReferenceMutation(ReferenceMutationFields, VideoServiceBase):
    __tablename__ = "video_reference_mutations"
