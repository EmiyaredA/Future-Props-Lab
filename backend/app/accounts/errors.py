class AccountError(Exception):
    def __init__(self, code: str, *, current: object | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.current = current
