from app.runtime.credentials import decrypt_secret


def encrypted_secret_hint(ciphertext: str) -> str:
    """Return a stable, non-sensitive hint for an encrypted secret."""
    if not ciphertext:
        return ""
    try:
        value = decrypt_secret(ciphertext)
    except Exception:
        return ""
    return value[-4:] if len(value) >= 4 else "••••"
