# ruff: noqa: E501

MIGRATION_ID = "r0062_call_log_credential"

SQL = r"""
ALTER TABLE llm_call_logs ADD COLUMN auth_kind VARCHAR(32);
ALTER TABLE llm_call_logs ADD COLUMN api_key_id VARCHAR(36);
ALTER TABLE llm_call_logs ADD COLUMN api_key_name VARCHAR(64);
ALTER TABLE llm_call_logs ADD COLUMN api_key_prefix VARCHAR(16);
CREATE INDEX ix_llm_call_logs_api_key_id ON llm_call_logs(api_key_id);
CREATE INDEX ix_llm_call_logs_auth_kind ON llm_call_logs(auth_kind);

ALTER TABLE model_inference_tasks ADD COLUMN auth_kind VARCHAR(32);
ALTER TABLE model_inference_tasks ADD COLUMN api_key_id VARCHAR(36);
ALTER TABLE model_inference_tasks ADD COLUMN api_key_name VARCHAR(64);
ALTER TABLE model_inference_tasks ADD COLUMN api_key_prefix VARCHAR(16);

ALTER TABLE model_test_generation_tasks ADD COLUMN auth_kind VARCHAR(32);
ALTER TABLE model_test_generation_tasks ADD COLUMN api_key_id VARCHAR(36);
ALTER TABLE model_test_generation_tasks ADD COLUMN api_key_name VARCHAR(64);
ALTER TABLE model_test_generation_tasks ADD COLUMN api_key_prefix VARCHAR(16);

ALTER TABLE model_test_transcription_tasks ADD COLUMN auth_kind VARCHAR(32);
ALTER TABLE model_test_transcription_tasks ADD COLUMN api_key_id VARCHAR(36);
ALTER TABLE model_test_transcription_tasks ADD COLUMN api_key_name VARCHAR(64);
ALTER TABLE model_test_transcription_tasks ADD COLUMN api_key_prefix VARCHAR(16);
"""
