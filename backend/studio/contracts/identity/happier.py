"""Public response for launching the Happier workspace."""

from pydantic import BaseModel

LAUNCH_PATH = "/v1/cloud-control/happier/launch"
EXCHANGE_PATH = "/v1/cloud-control/happier/exchange"
BROWSER_COOKIE = "__Host-fpl_happier"


class HappierLaunch(BaseModel):
    exchange_url: str
    ticket: str
