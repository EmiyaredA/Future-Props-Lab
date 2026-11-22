"""Retire unconfirmed/script-derived card design text; keep confirmed design."""

SQL = """
UPDATE visual_asset_cards
SET data = json_remove(data, '$.facts', '$.proposed_design'), revision = revision + 1
WHERE json_type(data, '$.facts') IS NOT NULL
   OR json_type(data, '$.proposed_design') IS NOT NULL;
"""
