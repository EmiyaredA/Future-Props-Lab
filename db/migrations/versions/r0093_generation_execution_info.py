"""Persist optional, normalized task telemetry without altering existing task state."""

MIGRATION_ID = "0093_generation_execution_info"
SQL = """
ALTER TABLE visual_generation_tasks ADD COLUMN execution_info JSON;
ALTER TABLE model_test_generation_tasks ADD COLUMN execution_info JSON;
ALTER TABLE model_inference_tasks ADD COLUMN execution_info JSON;
"""
