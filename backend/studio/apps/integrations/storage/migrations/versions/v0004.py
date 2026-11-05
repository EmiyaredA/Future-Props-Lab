"""Explicit user acknowledgement fences late queued external work without replay."""

SQL = (
    "CREATE TABLE integration_external_closures (\n"
    "\ttask_id VARCHAR(36) NOT NULL, \n"
    "\towner_user_id VARCHAR(36) NOT NULL, \n"
    "\tnote_id VARCHAR(100) NOT NULL, \n"
    "\tcreated_at DATETIME NOT NULL, \n"
    "\tPRIMARY KEY (task_id)\n"
    ");\n"
    "CREATE INDEX ix_integration_external_closures_owner_user_id ON integration_e"
    "xternal_closures (owner_user_id);\n"
)
