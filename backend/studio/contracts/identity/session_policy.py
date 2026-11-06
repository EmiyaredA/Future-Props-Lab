"""Session audiences selected by authenticated ingress, never browser input."""

from dataclasses import dataclass, replace


@dataclass(frozen=True)
class SessionPolicy:
    purpose: str = "studio"
    session_cookie: str = "fpl_session"
    csrf_cookie: str = "fpl_csrf"
    cookie_path: str = "/"


STUDIO_SESSION = SessionPolicy()
MANAGEMENT_SESSION = SessionPolicy("management", "fpl_management_session", "fpl_management_csrf")
PUBLIC_MANAGEMENT_SESSION = replace(MANAGEMENT_SESSION, cookie_path="/management")
