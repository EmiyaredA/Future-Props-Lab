"""Models audit delivery saves only inert intent ids and one-way digests."""

SQL = (
    "ALTER TABLE model_governance_audit ADD COLUMN source_fingerprint VARCHAR(64) NOT"
    " NULL DEFAULT '';\n"
    "ALTER TABLE model_governance_audit ADD COLUMN parent_intent_id VARCHAR(36) NOT N"
    "ULL DEFAULT '';\n"
    "ALTER TABLE model_governance_audit ADD COLUMN delivered_at DATETIME;\n"
    "ALTER TABLE model_template_sync_authority ADD COLUMN audit_intent_id VARCHAR(36)"
    " NOT NULL DEFAULT '';\n"
)
