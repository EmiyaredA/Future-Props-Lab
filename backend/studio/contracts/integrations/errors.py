from __future__ import annotations


class IntegrationNotFoundError(Exception):
    pass


class DuplicateIntegrationError(Exception):
    pass


class IntegrationValidationError(Exception):
    pass


class IntegrationPermissionError(Exception):
    pass


class IntegrationNotStarted(RuntimeError):
    """A configured operation was rejected before any outbound execution was dispatched."""
