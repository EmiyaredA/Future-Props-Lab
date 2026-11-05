"""Fixed demo-tool installation receipts; native schema slot 0005 is separate."""

SQL = (
    "CREATE TABLE integration_demo_tool_installations (\n"
    "\tintent_id VARCHAR(36) NOT NULL, \n"
    "\towner_user_id VARCHAR(36) NOT NULL, \n"
    "\tresult JSON NOT NULL, \n"
    "\tcreated_at DATETIME NOT NULL, \n"
    "\tPRIMARY KEY (intent_id)\n"
    ");\n"
    "CREATE INDEX ix_integration_demo_tool_installations_owner_user_id ON integra"
    "tion_demo_tool_installations (owner_user_id);\n"
)
