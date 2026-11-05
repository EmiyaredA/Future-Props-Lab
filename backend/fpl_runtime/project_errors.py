"""Project errors that can be mapped without importing a project implementation."""


class ProjectResourceError(Exception):
    def __init__(self, message, code="not_found", status=404):
        super().__init__(message)
        self.code, self.status = code, status
