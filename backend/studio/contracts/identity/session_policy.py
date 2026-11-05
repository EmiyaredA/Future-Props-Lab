"""Session audiences selected by authenticated ingress, never browser input."""

from dataclasses import dataclass


@dataclass(frozen=True)
class SessionPolicy:
    purpose: str = "studio"
    session_cookie: str = "fpl_session"
    csrf_cookie: str = "fpl_csrf"


STUDIO_SESSION = SessionPolicy()
MANAGEMENT_SESSION = SessionPolicy("management", "fpl_management_session", "fpl_management_csrf")
