"""Own fixed Integration validation capacity receipts; unknown reservations remain held."""

SQL = (
    "CREATE TABLE model_integration_capacity (\n"
    "\tintent_id VARCHAR(36) NOT NULL, \n"
    "\towner_user_id VARCHAR(36) NOT NULL, \n"
    "\tfingerprint VARCHAR(64) NOT NULL, \n"
    "\tlease_id VARCHAR(36) NOT NULL, \n"
    "\toutcome VARCHAR(24) NOT NULL, \n"
    "\tcreated_at DATETIME NOT NULL, \n"
    "\tPRIMARY KEY (intent_id), \n"
    "\tUNIQUE (lease_id)\n"
    ");\n"
    "CREATE INDEX ix_model_integration_capacity_owner_user_id ON model_integratio"
    "n_capacity (owner_user_id);\n"
)
