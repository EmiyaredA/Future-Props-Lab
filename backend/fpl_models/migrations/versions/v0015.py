"""Retain the original creation timestamps of migrated quota and demo policy."""

SQL = """
ALTER TABLE model_quota_policy ADD COLUMN created_at DATETIME;
UPDATE model_quota_policy SET created_at = updated_at WHERE created_at IS NULL;
ALTER TABLE model_demo_settings ADD COLUMN created_at DATETIME;
UPDATE model_demo_settings SET created_at = updated_at WHERE created_at IS NULL;
"""
