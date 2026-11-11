"""Retire Visual assistant provider runs and call logs."""

SQL = """
CREATE TEMP TABLE visual_dialogue_retirement_guard (
    unsettled INTEGER NOT NULL CHECK (unsettled = 0)
);
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_assistant_model_runs
WHERE state = 'open' OR round_state = 'submitting';
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_assistant_model_runs AS run
JOIN runtime_admissions AS lease
  ON lease.id = run.lease_id AND lease.owner_user_id = run.owner_user_id
WHERE lease.released_at IS NULL;
DROP TABLE visual_dialogue_retirement_guard;

DELETE FROM runtime_admissions
WHERE EXISTS (
    SELECT 1 FROM visual_assistant_model_runs AS run
    WHERE run.lease_id = runtime_admissions.id
      AND run.owner_user_id = runtime_admissions.owner_user_id
);
DROP TABLE visual_assistant_model_runs;
DELETE FROM llm_call_logs WHERE call_source = 'visual_workshop_assistant';
"""
