"""Read-only developer document protocol, independent of model governance."""

from pydantic import BaseModel


class DeveloperDocumentOut(BaseModel):
    id: str
    source: str
    group: str
    markdown: str


class DeveloperDocumentsOut(BaseModel):
    items: list[DeveloperDocumentOut]
