from pydantic import BaseModel


class ThoughtLinkPreview(BaseModel):
    url: str
    final_url: str
    domain: str
    title: str | None = None
    description: str | None = None
    available: bool = False
