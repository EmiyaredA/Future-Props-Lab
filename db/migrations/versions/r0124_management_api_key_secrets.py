MIGRATION_ID = "0124_management_api_key_secrets"

SQL = """
ALTER TABLE management_api_keys ADD COLUMN secret_ciphertext TEXT;
"""
