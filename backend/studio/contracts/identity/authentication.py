"""Stable authentication cookie and lifetime policy shared by protocol adapters."""

SESSION_COOKIE = "fpl_session"
CSRF_COOKIE = "fpl_csrf"
SESSION_IDLE_HOURS = 12
SESSION_ABSOLUTE_DAYS = 7
SESSION_ACTIVITY_WRITE_SECONDS = 300
REAUTH_MINUTES = 10
