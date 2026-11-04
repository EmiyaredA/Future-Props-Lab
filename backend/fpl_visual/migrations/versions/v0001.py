"""Initial owned Visual tables. External resource identifiers are opaque."""

SQL = """
CREATE TABLE visual_acceptance_templates (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    document JSON NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX ix_visual_acceptance_templates_owner_user_id ON visual_acceptance_templates
    (owner_user_id);

CREATE TABLE visual_certification_receipts (
    owner_user_id VARCHAR(36) NOT NULL,
    id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    authority VARCHAR(8192),
    audit_event_id VARCHAR(36),
    audit_proof VARCHAR(8192),
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, id)
);

CREATE INDEX ix_visual_certification_receipts_pending
    ON visual_certification_receipts (audit_event_id, created_at);

CREATE TABLE visual_workshop_projects (
    is_official BOOLEAN NOT NULL,
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX ix_visual_workshop_projects_owner_user_id ON visual_workshop_projects (owner_user_id);

CREATE INDEX ix_visual_workshop_projects_updated_at ON visual_workshop_projects (updated_at,
    created_at);

CREATE TABLE visual_acceptance_asset_references (
    owner_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (owner_id, asset_id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_acceptance_asset_references_project_id ON
    visual_acceptance_asset_references (project_id);

CREATE TABLE visual_acceptance_standard_versions (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    version INTEGER NOT NULL,
    document JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE,
    UNIQUE (project_id, version)
);

CREATE INDEX ix_visual_acceptance_standard_versions_owner_user_id ON
    visual_acceptance_standard_versions (owner_user_id);

CREATE TABLE visual_acceptance_standards (
    project_id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    draft JSON NOT NULL,
    published_version INTEGER NOT NULL,
    required BOOLEAN NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (project_id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_acceptance_standards_owner_user_id ON visual_acceptance_standards
    (owner_user_id);

CREATE TABLE visual_assistant_conversations (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    model_id VARCHAR(36),
    image_model_id VARCHAR(36),
    video_model_id VARCHAR(36),
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_assistant_conversations_owner_user_id ON visual_assistant_conversations
    (owner_user_id);

CREATE INDEX ix_visual_assistant_conversations_project_updated ON visual_assistant_conversations
    (project_id, updated_at, created_at);

CREATE TABLE visual_canvas_documents (
    project_id VARCHAR(36) NOT NULL,
    nodes JSON NOT NULL,
    edges JSON NOT NULL,
    categories JSON NOT NULL,
    revision INTEGER NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (project_id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE TABLE visual_generation_batches (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    batch_kind VARCHAR(16) NOT NULL,
    grid_size INTEGER NOT NULL,
    grid_output VARCHAR(16) NOT NULL,
    child_task_ids JSON NOT NULL,
    source_items JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    completed_count INTEGER NOT NULL,
    failed_count INTEGER NOT NULL,
    cancelled_count INTEGER NOT NULL,
    result_asset_id VARCHAR(36),
    error_message TEXT,
    generation_node_id VARCHAR(64),
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    completed_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_generation_batches_owner_user_id ON visual_generation_batches
    (owner_user_id);

CREATE INDEX ix_visual_generation_batches_project_created ON visual_generation_batches
    (project_id, created_at);

CREATE INDEX ix_visual_generation_batches_status_updated ON visual_generation_batches (status,
    updated_at);

CREATE TABLE visual_generation_tasks (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    provider_id VARCHAR(36),
    model_id VARCHAR(36),
    provider_kind VARCHAR(24) NOT NULL,
    generation_kind VARCHAR(16) NOT NULL,
    provider_name VARCHAR(120) NOT NULL,
    model_slug VARCHAR(160) NOT NULL,
    request_payload JSON NOT NULL,
    canvas_node_id VARCHAR(64),
    provider_task_id VARCHAR(255),
    submitted_at DATETIME,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    execution_info JSON,
    error_message TEXT,
    result_url TEXT,
    result_asset_id VARCHAR(36),
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    completed_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_generation_tasks_owner_user_id ON visual_generation_tasks (owner_user_id);

CREATE INDEX ix_visual_generation_tasks_project_canvas_node_created ON visual_generation_tasks
    (project_id, canvas_node_id, created_at);

CREATE INDEX ix_visual_generation_tasks_project_created ON visual_generation_tasks (project_id,
    created_at);

CREATE INDEX ix_visual_generation_tasks_provider ON visual_generation_tasks (provider_id, status);

CREATE INDEX ix_visual_generation_tasks_status_updated ON visual_generation_tasks (status,
    updated_at);

CREATE TABLE visual_node_acceptance_bindings (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    scheme_id VARCHAR(64),
    revision INTEGER NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (project_id, node_id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_node_acceptance_bindings_owner_user_id ON visual_node_acceptance_bindings
    (owner_user_id);

CREATE TABLE visual_node_outputs (
    id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    version INTEGER NOT NULL,
    kind VARCHAR(16) NOT NULL,
    asset_id VARCHAR(36),
    inspection_asset_id VARCHAR(36),
    text TEXT,
    source VARCHAR(16) NOT NULL,
    source_key VARCHAR(160) NOT NULL,
    generation_task_id VARCHAR(36),
    input_snapshot JSON NOT NULL,
    is_final BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE,
    UNIQUE (project_id, source_key),
    UNIQUE (project_id, node_id, version)
);

CREATE INDEX ix_visual_node_outputs_node_id ON visual_node_outputs (node_id);

CREATE INDEX ix_visual_node_outputs_project_id ON visual_node_outputs (project_id);

CREATE TABLE visual_project_asset_references (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    folder_id VARCHAR(36),
    display_name VARCHAR(255) NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_project_asset_references_folder ON visual_project_asset_references
    (project_id, folder_id, updated_at);

CREATE INDEX ix_visual_project_asset_references_owner_user_id ON visual_project_asset_references
    (owner_user_id);

CREATE TABLE visual_acceptance_runs (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    node_id VARCHAR(64) NOT NULL,
    output_id VARCHAR(36) NOT NULL,
    standard_id VARCHAR(36) NOT NULL,
    previous_run_id VARCHAR(36),
    request_id VARCHAR(100) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    model_id VARCHAR(36),
    scheme_id VARCHAR(64) NOT NULL,
    execution_result JSON NOT NULL,
    status VARCHAR(24) NOT NULL,
    decision VARCHAR(24) NOT NULL,
    snapshot JSON NOT NULL,
    results JSON NOT NULL,
    evidence JSON NOT NULL,
    decisions JSON NOT NULL,
    error_message TEXT,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(standard_id) REFERENCES visual_acceptance_standard_versions (id) ON DELETE RESTRICT,
    FOREIGN KEY(output_id) REFERENCES visual_node_outputs (id) ON DELETE RESTRICT,
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE,
    UNIQUE (project_id, request_id, output_id)
);

CREATE INDEX ix_visual_acceptance_runs_owner_user_id ON visual_acceptance_runs (owner_user_id);

CREATE INDEX ix_visual_acceptance_runs_project_id ON visual_acceptance_runs (project_id);

CREATE TABLE visual_assistant_messages (
    id VARCHAR(36) NOT NULL,
    conversation_id VARCHAR(36) NOT NULL,
    position INTEGER NOT NULL,
    turn_id VARCHAR(36) NOT NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    content_parts JSON NOT NULL,
    model_slug VARCHAR(160) NOT NULL,
    status VARCHAR(16) NOT NULL,
    error_message TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(conversation_id) REFERENCES visual_assistant_conversations (id) ON DELETE CASCADE,
    CONSTRAINT uq_visual_assistant_message_position UNIQUE (conversation_id, position)
);

CREATE INDEX ix_visual_assistant_messages_conversation ON visual_assistant_messages
    (conversation_id, position);

CREATE INDEX ix_visual_assistant_messages_conversation_id ON visual_assistant_messages
    (conversation_id);

CREATE INDEX ix_visual_assistant_messages_status ON visual_assistant_messages (status);

CREATE INDEX ix_visual_assistant_messages_turn_id ON visual_assistant_messages (turn_id);

CREATE TABLE visual_acceptance_repair_drafts (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    run_id VARCHAR(36) NOT NULL,
    text TEXT NOT NULL,
    revision INTEGER NOT NULL,
    prompt_version_id VARCHAR(64),
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE,
    FOREIGN KEY(run_id) REFERENCES visual_acceptance_runs (id) ON DELETE CASCADE
);

CREATE INDEX ix_visual_acceptance_repair_drafts_owner_user_id ON visual_acceptance_repair_drafts
    (owner_user_id);

CREATE TABLE visual_assistant_actions (
    id VARCHAR(36) NOT NULL,
    message_id VARCHAR(36) NOT NULL,
    action_id VARCHAR(160) NOT NULL,
    run_id VARCHAR(36) NOT NULL,
    approval_group_id VARCHAR(36),
    position INTEGER NOT NULL,
    tool_name VARCHAR(100) NOT NULL,
    effect VARCHAR(16) NOT NULL,
    status VARCHAR(24) NOT NULL,
    display_payload JSON NOT NULL,
    result_payload JSON NOT NULL,
    error_message TEXT,
    duration_ms INTEGER,
    canvas_revision INTEGER,
    generation_task_id VARCHAR(36),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_visual_assistant_action_id UNIQUE (message_id, action_id),
    FOREIGN KEY(generation_task_id) REFERENCES visual_generation_tasks (id) ON DELETE SET NULL,
    FOREIGN KEY(message_id) REFERENCES visual_assistant_messages (id) ON DELETE CASCADE,
    CONSTRAINT uq_visual_assistant_action_position UNIQUE (message_id, position)
);

CREATE INDEX ix_visual_assistant_actions_generation_task ON visual_assistant_actions
    (generation_task_id);

CREATE INDEX ix_visual_assistant_actions_message ON visual_assistant_actions (message_id, position);

CREATE INDEX ix_visual_assistant_actions_run ON visual_assistant_actions (run_id, status);

CREATE TABLE visual_assistant_message_assets (
    id VARCHAR(36) NOT NULL,
    message_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_visual_assistant_message_asset_position UNIQUE (message_id, position),
    FOREIGN KEY(message_id) REFERENCES visual_assistant_messages (id) ON DELETE CASCADE,
    CONSTRAINT uq_visual_assistant_message_asset UNIQUE (message_id, asset_id)
);

CREATE INDEX ix_visual_assistant_message_assets_asset ON visual_assistant_message_assets (asset_id);
"""
