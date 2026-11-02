"""Retire mock test tool definitions, bindings and execution records."""

MIGRATION_ID = "0119_retire_model_test_tools"

SQL = """
DROP TABLE model_test_tool_calls;
DROP TABLE model_test_conversation_tool_bindings;
DROP TABLE model_test_tools;
"""
