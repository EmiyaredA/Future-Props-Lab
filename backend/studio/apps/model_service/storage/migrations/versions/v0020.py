"""Persist non-secret credential attribution for assistant settlement."""

SQL = """
ALTER TABLE visual_assistant_model_runs ADD COLUMN credential_attribution JSON;
"""
