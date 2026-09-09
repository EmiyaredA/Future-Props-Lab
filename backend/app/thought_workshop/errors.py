class ThoughtError(Exception):
    def __init__(self, message: str, status: int = 422, code: str = "thought_error"):
        super().__init__(message)
        self.status, self.code = status, code
