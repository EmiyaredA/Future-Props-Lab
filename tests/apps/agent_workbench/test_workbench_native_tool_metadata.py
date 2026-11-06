"""Native parsers preserve tool metadata and associations across Agent formats."""


def test_native_tool_metadata_keeps_association_without_inventing_missing_results():
    from studio.contracts.agent_workbench.session_history import SessionInfo
    from studio.host.session_collection import opencode, parsers

    info = SessionInfo()
    parsers.codex({"type": "turn_context", "payload": {"turn_id": "turn-1"}}, 1, info, "")
    call = parsers.codex(
        {
            "type": "response_item",
            "payload": {
                "id": "output-item",
                "type": "function_call",
                "call_id": "same",
                "name": "exec",
            },
        },
        2,
        info,
        "",
    )[0]
    result = parsers.codex(
        {
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "same",
                "output": "native output",
            },
        },
        3,
        info,
        "",
    )[0]
    assert call.native_id != result.native_id
    assert {k: call.presentation[k] for k in ("turn_id", "call_id")} == result.presentation
    assert call.presentation["details"]["kind"] == "command"
    [search] = parsers.codex(
        {
            "type": "response_item",
            "payload": {
                "type": "web_search_call",
                "id": "web",
                "status": "completed",
                "action": {"type": "search", "query": "Codex turn steer"},
            },
        },
        4,
        info,
        "",
    )
    assert search.presentation["details"]["label"] == "Codex turn steer"
    [duration] = parsers.codex(
        {"type": "event_msg", "payload": {"type": "task_complete", "duration_ms": 2200}},
        5,
        info,
        "",
    )
    assert duration.kind == "duration" and duration.presentation["details"]["duration_ms"] == 2200

    call, result = [
        parsers.claude(
            {
                "type": role,
                "uuid": key,
                "message": {"content": [part]},
            },
            index,
            SessionInfo(),
            "",
        )[0]
        for index, (role, key, part) in enumerate(
            [
                ("assistant", "a", {"type": "tool_use", "id": "tool-a", "name": "Bash"}),
                ("user", "b", {"type": "tool_result", "tool_use_id": "tool-a", "is_error": True}),
            ]
        )
    ]
    assert call.presentation["call_id"] == result.presentation["call_id"] == "tool-a"
    assert result.role == "tool" and result.presentation["status"] == "failed"

    [tool] = opencode.entries(
        [
            {
                "info": {"id": "assistant", "parentID": "user", "time": {"created": 1000}},
                "parts": [
                    {
                        "id": "part",
                        "type": "tool",
                        "tool": "read",
                        "state": {"status": "completed", "input": {"path": "a"}, "output": "ok"},
                    }
                ],
            }
        ]
    )
    assert tool.presentation["turn_id"] == "user"
    assert [x["kind"] for x in tool.presentation["blocks"]] == ["tool_call", "tool_result"]

    dsh_call = parsers.dsh(
        {"type": "tool/call", "data": {"callId": "tool-b", "name": "read"}},
        1,
        SessionInfo(),
        "",
    )[0]
    dsh_result = parsers.dsh(
        {"type": "tool/result", "data": {"content": "missing native link"}},
        2,
        SessionInfo(),
        "",
    )[0]
    assert dsh_call.presentation["call_id"] == "tool-b"
    assert dsh_result.presentation["call_id"] is None

    [node] = parsers.pi(
        {
            "type": "message",
            "id": "node",
            "parentId": "root",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "explanation"},
                    {
                        "type": "toolCall",
                        "name": "read",
                        "id": "pi-call",
                        "arguments": {"path": "src/pi.ts", "offset": 9},
                    },
                ],
            },
        },
        1,
        SessionInfo(),
        "",
    )
    assert node.native_id == "node" and node.parent_id == "root"
    assert [x["kind"] for x in node.presentation["blocks"]] == ["message", "tool_call"]
    assert node.presentation["blocks"][1]["call_id"] == "pi-call"
    assert node.presentation["blocks"][1]["details"]["file"] == {"path": "src/pi.ts", "line": 9}
