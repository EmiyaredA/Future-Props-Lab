from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AgentFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    criterion_id: str
    suggestion: Literal["passed", "failed", "pending"]
    explanation: str = Field(min_length=1, max_length=3000)
    evidence_ids: list[str] = Field(max_length=48)
    start_ms: int | None = Field(ge=0)
    end_ms: int | None = Field(ge=0)


class AgentReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=4000)
    findings: list[AgentFinding] = Field(max_length=4)
    limitations: list[str] = Field(max_length=20)


def validate_report(payload, criteria, evidence, duration):
    report = AgentReport.model_validate(payload)
    expected = {item["id"] for item in criteria if item["method"] == "ai"}
    ids = [item.criterion_id for item in report.findings]
    if set(ids) != expected or len(ids) != len(expected):
        raise ValueError("Agent 未返回完整的逐项发现")
    available = {item["id"] for item in evidence}
    for item in report.findings:
        if not item.evidence_ids or not set(item.evidence_ids) <= available:
            raise ValueError("Agent 引用了未读取的证据")
        if (item.start_ms is None) != (item.end_ms is None) or (
            item.start_ms is not None and not 0 <= item.start_ms < item.end_ms <= duration
        ):
            raise ValueError("Agent 问题区间无效")
    return report
