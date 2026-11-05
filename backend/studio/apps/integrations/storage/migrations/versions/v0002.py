"""Inert validation attempts record ambiguous dispatch and quota settlement."""

SQL = (
    "CREATE TABLE integration_validation_attempts (\n"
    "\tid VARCHAR(36) NOT NULL, \n"
    "\towner_user_id VARCHAR(36) NOT NULL, \n"
    "\tscope JSON NOT NULL, \n"
    "\tstatus VARCHAR(24) NOT NULL, \n"
    "\treleased BOOLEAN NOT NULL, \n"
    "\tcreated_at DATETIME NOT NULL, \n"
    "\tupdated_at DATETIME NOT NULL, \n"
    "\tPRIMARY KEY (id)\n"
    ");\n"
    "CREATE INDEX ix_integration_validation_attempts_owner_user_id ON integration"
    "_validation_attempts (owner_user_id);\n"
)
