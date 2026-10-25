"""Protect native template scenes against older writers; no legacy reflow."""

MIGRATION_ID = "r0112_presentation_native_templates"
SQL = """
CREATE TRIGGER presentation_templates_no_format_downgrade
BEFORE UPDATE OF definition ON presentation_templates
WHEN json_extract(OLD.definition, '$.version') >= 2
 AND coalesce(json_extract(NEW.definition, '$.version'), 1) < 2
BEGIN
 SELECT RAISE(ABORT, 'presentation template format downgrade');
END;
CREATE TRIGGER presentation_projects_no_format_downgrade
BEFORE UPDATE OF document ON presentation_projects
WHEN json_extract(OLD.document, '$.version') >= 5
 AND coalesce(json_extract(NEW.document, '$.version'), 1) < 5
BEGIN
 SELECT RAISE(ABORT, 'presentation document format downgrade');
END;
CREATE TRIGGER presentation_examples_no_format_downgrade
BEFORE UPDATE OF document ON presentation_examples
WHEN json_extract(OLD.document, '$.version') >= 5
 AND coalesce(json_extract(NEW.document, '$.version'), 1) < 5
BEGIN
 SELECT RAISE(ABORT, 'presentation example format downgrade');
END;
"""
