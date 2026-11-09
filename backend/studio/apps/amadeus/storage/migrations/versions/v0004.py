SQL = """
ALTER TABLE amadeus_messages ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT 0;

CREATE TABLE amadeus_fork_receipts (
    conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
    request_id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    message_id VARCHAR(36) NOT NULL,
    branch_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (conversation_id, request_id)
);
"""
