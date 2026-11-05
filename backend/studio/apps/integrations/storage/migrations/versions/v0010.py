"""Persist one-shot Amadeus integration call receipts by exact Identity intent."""

SQL = """
CREATE TABLE integration_amadeus_tool_calls (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    status VARCHAR(24) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_integration_amadeus_tool_calls_owner_user_id
    ON integration_amadeus_tool_calls (owner_user_id);
"""
