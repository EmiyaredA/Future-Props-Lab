"""Behavioral checks for the portable skill; never call a provider or live App."""

import copy
import hashlib
import importlib
import os
import subprocess
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

SKILL = (
    Path(__file__).resolve().parents[1]
    / "skills/future-props-lab-automation/skills/visual-workshop/visual-character-replacement"
)


@pytest.fixture
def modules(monkeypatch):
    monkeypatch.syspath_prepend(str(SKILL / "scripts"))
    return importlib.import_module("production_record"), importlib.import_module("review_board")


@pytest.fixture
def record(modules):
    pr, rb = modules
    value = rb.load(SKILL / "assets/templates/demo.json")
    return pr.validate(value)


def feedback(pr, record, entries):
    return {
        "schema_version": 1,
        "record_id": record["record_id"],
        "revision": record["revision"],
        "snapshot_hash": pr.digest(record),
        "entries": entries,
    }


def candidate_entry(pr, record, decision="needs_changes"):
    shot = record["shots"][0]
    candidate = shot["candidates"][0]
    return {
        "kind": "candidate",
        "shot_id": shot["id"],
        "candidate_id": candidate["id"],
        "subject_hash": pr.subject_hash(record, shot, candidate),
        "decision": decision,
        "note": "请检查侧脸身份与肩部接触",
    }


def gate_entry(pr, record, gate):
    return {
        "kind": "gate",
        "gate": gate,
        "subject_hash": pr.gate_hash(record, gate),
        "decision": "approve",
        "note": "已查看并确认",
    }


def pass_checks(pr, record):
    for shot in record["shots"]:
        for candidate in shot["candidates"]:
            candidate["checks"] = [
                {
                    "dimension": d,
                    "verdict": "pass",
                    "subject_hash": pr.subject_hash(record, shot, candidate),
                    "note": "隔离测试证据",
                    "evidence": [{"kind": pr.EVIDENCE[d], "time": 0, "text": "测试"}],
                }
                for d in shot["required_checks"]
            ]


def test_feedback_append_revision_and_no_side_effects(modules, record):
    pr, _ = modules
    before = copy.deepcopy(record)
    result = pr.merge_feedback(record, feedback(pr, record, [candidate_entry(pr, record)]))
    assert record == before
    assert result["revision"] == record["revision"] + 1
    assert result["shots"][0]["decisions"][-1]["decision"] == "needs_changes"
    assert result["shots"][0]["candidates"] == record["shots"][0]["candidates"]


@pytest.mark.parametrize(
    "field,value",
    [("record_id", "other"), ("revision", 99), ("revision", False), ("snapshot_hash", "changed")],
)
def test_stale_wrong_record_feedback_rejected(modules, record, field, value):
    pr, _ = modules
    data = feedback(pr, record, [candidate_entry(pr, record)])
    data[field] = value
    with pytest.raises(pr.RecordError):
        pr.merge_feedback(record, data)


@pytest.mark.parametrize(
    "field,value",
    [
        ("shot_id", "missing"),
        ("candidate_id", "missing"),
        ("subject_hash", "old"),
        ("decision", "execute"),
        ("note", ""),
    ],
)
def test_unknown_or_invalid_candidate_feedback_rejected(modules, record, field, value):
    pr, _ = modules
    entry = candidate_entry(pr, record)
    entry[field] = value
    with pytest.raises(pr.RecordError):
        pr.merge_feedback(record, feedback(pr, record, [entry]))


def test_duplicate_feedback_rejected_atomically(modules, record):
    pr, _ = modules
    entry = candidate_entry(pr, record)
    with pytest.raises(pr.RecordError, match="重复"):
        pr.merge_feedback(record, feedback(pr, record, [entry, entry]))
    assert record["shots"][0]["decisions"] == []


def test_changed_input_invalidates_checks_user_and_adoption(modules, record):
    pr, _ = modules
    shot = record["shots"][0]
    candidate = shot["candidates"][0]
    entry = candidate_entry(pr, record, "approve")
    record = pr.merge_feedback(record, feedback(pr, record, [entry]))
    shot = record["shots"][0]
    candidate = shot["candidates"][0]
    shot["adopted"] = {
        "candidate_id": candidate["id"],
        "subject_hash": pr.subject_hash(record, shot, candidate),
    }
    assert pr.adopted_candidate(record, shot)
    candidate["input_snapshot"]["reference_output_id"] = "new-reference-version"
    assert pr.candidate_status(record, shot, candidate) == "stale"
    assert pr.user_decision(record, shot, candidate) == "stale"
    assert pr.reconcile(record)["shots"][0]["adopted"] is None
    assert shot["decisions"][-1]["decision"] == "approve"


def test_reference_mapping_and_scene_change_invalidate(modules, record):
    pr, _ = modules
    shot = record["shots"][1]
    candidate = shot["candidates"][0]
    before = pr.subject_hash(record, shot, candidate)
    record["characters"][1]["mapping"] = "原片角色 B → 新身份"
    record["scenes"][0]["description"] = "更改接触面与空间"
    assert before != pr.subject_hash(record, shot, candidate)


def test_gate_checks_and_order_independent_merge(modules, record):
    pr, _ = modules
    with pytest.raises(pr.RecordError):
        pr.merge_feedback(record, feedback(pr, record, [gate_entry(pr, record, "representative")]))
    pass_checks(pr, record)
    result = pr.merge_feedback(
        record,
        feedback(
            pr, record, [gate_entry(pr, record, "representative"), gate_entry(pr, record, "scheme")]
        ),
    )
    assert pr.gate_status(result, "representative") == "approve"
    assert pr.gate_status(result, "final") == "pending"
    shot = result["shots"][1]
    entry = candidate_entry(pr, result)
    entry.update(
        shot_id=shot["id"],
        candidate_id=shot["selected_candidate_id"],
        subject_hash=pr.fingerprints(result, shot)[shot["selected_candidate_id"]],
        decision="reject",
    )
    rejected = pr.merge_feedback(result, feedback(pr, result, [entry]))
    assert pr.gate_status(rejected, "representative") == "stale"


def test_comment_does_not_clear_rejection(modules, record):
    pr, _ = modules
    rejected = pr.merge_feedback(
        record, feedback(pr, record, [candidate_entry(pr, record, "reject")])
    )
    result = pr.merge_feedback(
        rejected, feedback(pr, rejected, [candidate_entry(pr, rejected, "comment")])
    )
    shot = result["shots"][0]
    assert pr.user_decision(result, shot, shot["candidates"][0]) == "reject"


def test_complete_final_gate_requires_adoptions_and_checks(modules, record):
    pr, _ = modules
    pass_checks(pr, record)
    record = pr.merge_feedback(
        record,
        feedback(
            pr, record, [gate_entry(pr, record, "scheme"), gate_entry(pr, record, "representative")]
        ),
    )
    final = copy.deepcopy(record["shots"][0]["candidates"][0])
    final.update(id="final-v1", stage="final")
    record["final"]["candidate"] = final
    for shot in record["shots"]:
        shot["adopted"] = {
            "candidate_id": shot["selected_candidate_id"],
            "subject_hash": pr.fingerprints(record, shot)[shot["selected_candidate_id"]],
        }
    final["checks"] = [
        {
            "dimension": d,
            "verdict": "pass",
            "subject_hash": pr.final_hash(record),
            "note": "测试实际导出",
            "evidence": [{"kind": pr.EVIDENCE[d], "time": 0, "text": "测试"}],
        }
        for d in record["final"]["required_checks"]
    ]
    result = pr.merge_feedback(record, feedback(pr, record, [gate_entry(pr, record, "final")]))
    assert pr.gate_status(result, "final") == "approve"
    result["final"]["issues"].append("尾音需要处理")
    assert pr.gate_status(result, "final") == "stale"


def test_preserve_and_action_based_long_segments(modules, record):
    pr, _ = modules
    shot = record["shots"][2]
    shot.update(
        type="preserve",
        character_ids=[],
        candidates=[],
        selected_candidate_id=None,
        source_range=[0, 16.7],
        segments=[
            {"range": [0, 6.1], "reason": "动作 A 完成"},
            {"range": [6.1, 16.7], "reason": "停顿后动作 B"},
        ],
    )
    pr.validate(record)
    shot["segments"][1]["range"][0] = 6.2
    with pytest.raises(pr.RecordError, match="连续"):
        pr.validate(record)


def test_pass_requires_modality_evidence(modules, record):
    pr, _ = modules
    record["shots"][0]["candidates"][0]["checks"][0]["evidence"][0]["kind"] = "frame"
    with pytest.raises(pr.RecordError, match="对应实际证据"):
        pr.validate(record)


@pytest.mark.parametrize(
    "path", ["../secret.png", "/private/file.png", "https://example.com/a.png", "C:\\file.png"]
)
def test_media_path_boundary(modules, path):
    pr, _ = modules
    with pytest.raises(pr.RecordError):
        pr.media_path(path)


def test_media_render_binding_missing_and_symlink(modules, record, tmp_path):
    pr, rb = modules
    source = tmp_path / "source"
    source.mkdir()
    media = source / "still.svg"
    media.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    record["shots"][0]["source_media"] = {
        "kind": "image",
        "path": "still.svg",
        "sha256": hashlib.sha256(media.read_bytes()).hexdigest(),
    }
    input_path = source / "record.json"
    rb.write_json(input_path, record)
    result = rb.render(record, input_path, tmp_path / "preview")
    assert Path(result["html"]).is_file()
    assert len(list((tmp_path / "preview/media").iterdir())) == 1
    media.write_text("changed")
    with pytest.raises(pr.RecordError, match="SHA256"):
        rb.render(record, input_path, tmp_path / "other")
    media.unlink()
    view, prepared = rb.local_media(record, source)
    assert view["shots"][0]["source_media"]["missing"] and not prepared
    outside = tmp_path / "outside.svg"
    outside.write_text("outside")
    media.symlink_to(outside)
    with pytest.raises(pr.RecordError, match="越界"):
        rb.local_media(record, source)


def test_templates_escape_user_text_and_preserve_shared_revision(modules, record, tmp_path):
    _, rb = modules
    record["title"] = '</script><script>alert("x")</script>'
    rb.write_json(tmp_path / "record.json", record)
    result = rb.render(record, tmp_path / "record.json", tmp_path / "preview")
    page = Path(result["html"]).read_text()
    assert record["title"] not in page
    assert "\\u003c/script>" in page
    for name in result["text_boards"]:
        text = (tmp_path / "preview" / f"{name}.md").read_text()
        assert f"revision {record['revision']}" in text
        assert "<script>" not in text


def test_cli_init_reconcile_and_no_silent_overwrite(modules, tmp_path):
    _, rb = modules
    output = tmp_path / "record.json"
    assert rb.main(["init", "--title", "隔离演示", "--demo", "--output", str(output)]) == 0
    assert rb.main(["init", "--title", "覆盖", "--output", str(output)]) == 2
    assert (
        rb.main(
            [
                "reconcile",
                "--input",
                str(output),
                "--expected-revision",
                "99",
                "--output",
                str(tmp_path / "new.json"),
            ]
        )
        == 2
    )
    assert not (tmp_path / "new.json").exists()


def test_duplicate_json_keys_rejected(modules, tmp_path):
    pr, rb = modules
    path = tmp_path / "duplicates.json"
    path.write_text('{"revision":0,"revision":1}')
    with pytest.raises(pr.RecordError, match="键重复"):
        rb.load(path)


def test_input_snapshot_is_not_interpreted_as_local_media(modules, record, tmp_path):
    _, rb = modules
    snapshot = {"kind": "image", "path": "App-managed/reference.png", "output_id": "o1"}
    record["shots"][0]["candidates"][0]["input_snapshot"] = snapshot
    view, prepared = rb.local_media(record, tmp_path)
    assert view["shots"][0]["candidates"][0]["input_snapshot"] == snapshot
    assert not prepared


def test_single_skill_zip_accepted_by_app_importer(tmp_path):
    from app.integrations.skills.archive import SkillArchiveStorage

    archive = tmp_path / "skill.zip"
    with zipfile.ZipFile(archive, "w") as file:
        for path in SKILL.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:
                file.write(path, f"{SKILL.name}/{path.relative_to(SKILL)}")
    storage = object.__new__(SkillArchiveStorage)
    storage.settings = SimpleNamespace(
        fpl_skill_max_files=500, fpl_skill_expanded_max_bytes=50 * 1024 * 1024
    )
    staged = storage._extract(archive, tmp_path / "extracted", "test-digest")
    assert staged.name == "visual-character-replacement"
    assert (staged.directory / "assets/templates/board.html").is_file()
    assert not list(staged.directory.rglob("*.mp4"))


@pytest.mark.skipif(
    os.environ.get("FPL_SKILL_BROWSER_CHECK") != "1",
    reason="Opt in to the isolated local Playwright check with FPL_SKILL_BROWSER_CHECK=1",
)
def test_browser_review_interactions(modules, record, tmp_path):
    pr, rb = modules
    record["title"] = "演示 <img src=x onerror=window.injected=true>"
    record["shots"][0]["source_media"] = {
        "kind": "image",
        "path": "missing.png",
        "sha256": "0" * 64,
    }
    path = tmp_path / "record.json"
    rb.write_json(path, record)
    rb.render(record, path, tmp_path / "preview")
    script = r"""
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    headless:true, channel:process.env.FPL_TEST_BROWSER || 'chrome'
  });
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.argv[1]);
    await page.locator('#detail h2').waitFor();
    assert.equal(await page.locator('#progress tr').count(),3);
    assert.equal(await page.locator('#title img').count(),0);
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    assert.match(await page.locator('#detail').innerText(),/媒体缺失/);
    await page.locator('[data-filter="repair"]').click();
    assert.equal(await page.locator('#shots button').count(),1);
    await page.locator('#detail').getByRole('button',{name:'返修记录',exact:true}).click();
    assert.match(await page.locator('#detail').innerText(),/根因判断/);
    await page.locator('#detail').getByRole('button',{name:'候选对照',exact:true}).click();
    await page.locator('#detail textarea').fill('保留搭肩接触 <script>test</script>');
    await page.locator('#detail').getByRole('button',{name:'要求修改',exact:true}).click();
    await page.locator('[data-filter="all"]').click();
    await page.locator('#shots button').filter({hasText:'S001'}).click();
    await page.locator('#shots button').filter({hasText:'S017'}).click();
    assert.match(await page.locator('#detail textarea').inputValue(),/保留搭肩/);
    const waiting=page.waitForEvent('download');
    await page.locator('#export').click();
    await (await waiting).saveAs(process.argv[2]);
    assert.equal(await page.locator('#dirty').innerText(),'暂无未导出意见');
    await page.locator('#theme').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#progress button').filter({hasText:'S018'}).click();
    assert.match(await page.locator('#detail h2').innerText(),/S018/);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
"""
    exported = tmp_path / "feedback.json"
    subprocess.run(
        ["node", "-e", script, (tmp_path / "preview/index.html").as_uri(), str(exported)],
        cwd=SKILL.parents[4],
        check=True,
        timeout=60,
        capture_output=True,
        text=True,
    )
    result = pr.merge_feedback(record, rb.load(exported))
    assert result["shots"][1]["decisions"][-1]["decision"] == "needs_changes"
    assert result["revision"] == record["revision"] + 1
