"""Stable editing errors shared by rules and receipt adapters."""


class OperationError(Exception):
    def __init__(self, message: str, code="invalid_operation", status=422):
        super().__init__(message)
        self.code, self.status = code, status
