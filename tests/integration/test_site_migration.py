import json
from uuid import uuid4

import pytest
from scripts.website import migrate_site as site


def private_json(path, data):
    path.touch(mode=0o600)
    path.write_text(json.dumps(data))
    return path


def endpoints():
    return {
        name: f"http://127.0.0.1:{21000 + index}"
        for index, name in enumerate(sorted(site.ENDPOINTS))
    }


def test_maintenance_addresses_require_full_distinct_loopback_inventory(tmp_path):
    path = tmp_path / "endpoints.json"
    values = endpoints()
    assert site.read_endpoints(private_json(path, values)) == values
    values["identity-target"] = values["identity-source"].replace(":21", ":021")
    with pytest.raises(ValueError, match="独立回环地址"):
        site.read_endpoints(private_json(path, values))
    values.pop("rendering-target")
    with pytest.raises(ValueError, match="全部迁移端点"):
        site.read_endpoints(private_json(path, values))


def test_site_transfer_records_interruption_and_reverifies_before_completion(tmp_path, monkeypatch):
    addresses = endpoints()
    evidence = tmp_path / "evidence"
    evidence.mkdir(mode=0o700)
    plan = private_json(
        tmp_path / "plan.json",
        {
            "run_id": str(uuid4()),
            "source_revision": "a" * 40,
            "source_database_sha256": "b" * 64,
            "owner_ids": [],
            "token": "synthetic-migration-plan-token-for-tests",
        },
    )
    checks = {"tables": [], "pending_tables": ["unknown_source_table"]}
    monkeypatch.setattr(site, "inspect_bundle", lambda *_args, **_kwargs: checks)
    seen = []
    outage = {"visual_history"}
    mismatch = set()

    def invoke(name, args, plan_path, _lock):
        assert plan_path == plan
        seen.append(name)
        if name in outage:
            raise ValueError("isolated interruption")
        if name == "creative_installations":
            assert args == {
                "source": addresses["creative-target"],
                "target": addresses["integrations-target"],
                "legacy": addresses["integrations-source"],
            }
        return [{"dataset": name, "record_count": int(name in mismatch)}]

    monkeypatch.setattr(site, "step_report", invoke)
    params = (plan, tmp_path, "c" * 64, addresses, evidence)
    with pytest.raises(ValueError, match="unknown_source_table"):
        site.migrate(*params)
    assert not seen
    checks["pending_tables"].clear()

    with pytest.raises(ValueError, match="interruption"):
        site.migrate(*params)
    before = json.loads((evidence / "transfer.json").read_text())
    assert before["complete"] is False
    assert set(before["steps"]) == set(seen[:-1])

    outage.clear()
    seen.clear()
    journal = site.migrate(*params)
    after = json.loads(journal.read_text())
    assert seen == [name for name, _ in site.STEPS]
    assert seen.index("identity") < seen.index("assets") < seen.index("thought_references")
    assert after["complete"] is True
    assert all(after["steps"][key] == value for key, value in before["steps"].items())
    mismatch.add("assets")
    with pytest.raises(ValueError, match="报告变化 assets"):
        site.migrate(*params)
    assert json.loads(journal.read_text())["complete"] is False


def test_final_coverage_checks_table_counts_and_required_relationship_reports():
    def table(name, dataset, count, status="dataset_registered"):
        return {"table": name, "dataset": dataset, "record_count": count, "status": status}

    tables = {
        "tables": [
            table("users", "identity.accounts", 2),
            table("presentation_asset_references", "presentation.project-references", 3),
            table("agent_workbench_search", "agents.search", 7, "rebuild_registered"),
            {
                "table": "project_operation_receipts",
                "record_count": 2,
                "status": "dataset_registered",
                "partitions": {"thought": 2},
                "datasets": {"thought": "thought.note-operation-receipts"},
            },
            {
                "table": "platform_settings",
                "record_count": 4,
                "status": "dataset_registered",
                "partitions": {"models": 3, "agent-runtime": 1},
            },
        ],
    }
    reports = {
        "fixture": [
            {"dataset": "identity.accounts", "record_count": 2},
            {"dataset": "presentation.project-references", "record_count": 1},
            {"dataset": "thought.note-operation-receipts", "record_count": 2},
            {"dataset": "models.account-defaults", "record_count": 1},
            {"dataset": "models.policy", "record_count": 2},
        ]
    }
    with pytest.raises(ValueError, match="缺少数据集验收结果 agents.search"):
        site.validate_coverage(tables, reports)
    reports["fixture"].append({"dataset": "agents.search", "sha256": "a" * 64})
    site.validate_coverage(tables, reports)
    reports["fixture"][0]["record_count"] = 1
    with pytest.raises(ValueError, match="记录数与封存来源不符 identity.accounts"):
        site.validate_coverage(tables, reports)
