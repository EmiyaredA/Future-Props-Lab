"""Distinguish restored derived files from requests that need execution."""

SQL = """
ALTER TABLE video_media_dispatches
ADD COLUMN historical BOOLEAN NOT NULL DEFAULT 0 CHECK(historical IN (0, 1));
"""
