"""Record the verified Visual project parent of conversation reference sets."""

SQL = """
ALTER TABLE asset_reference_sets ADD COLUMN scope_project_id VARCHAR(128);
"""
