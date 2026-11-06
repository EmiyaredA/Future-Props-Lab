"""Public response for launching the Happier workspace."""

from pydantic import BaseModel


class HappierLaunch(BaseModel):
    exchange_url: str
    ticket: str
