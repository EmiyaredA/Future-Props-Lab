"""Persist native result retirement before removing delivery bytes or source text."""

SQL = """
ALTER TABLE model_native_jobs ADD COLUMN retired_at DATETIME;
ALTER TABLE model_native_jobs ADD COLUMN artifacts_removed_at DATETIME;
CREATE INDEX ix_model_native_jobs_artifact_retention
    ON model_native_jobs(applied_at, artifacts_removed_at);
"""
