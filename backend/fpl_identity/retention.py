"""Only an authorized original write can issue a bounded retention authority."""

import re
import secrets
import time

import jwt
from fastapi import HTTPException

from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import route_permission
from fpl_runtime.annotation_assets import PROJECT_CREATION
from fpl_runtime.annotation_assets import SOURCE as ANNOTATION
from fpl_runtime.claims import verify_context
from fpl_runtime.motion_assets import SOURCE as MOTION
from fpl_runtime.presentation_archives import IMPORT as PRESENTATION_IMPORT
from fpl_runtime.presentation_assets import BUNDLE as PRESENTATION_BUNDLE
from fpl_runtime.presentation_assets import LIBRARY as PRESENTATION_LIBRARY
from fpl_runtime.presentation_assets import PROJECTS as PRESENTATION
from fpl_runtime.retention_authority import (
    canvas_metadata,
    issue_retention,
    story_metadata,
    verify_retention,
)
from fpl_runtime.video_assets import SOURCE as VIDEO
from fpl_runtime.video_handoff import handoff_target
from fpl_runtime.visual_assistant import conversation_retention, message_source
from fpl_runtime.visual_review import start_source as visual_review_start
from fpl_runtime.visual_samples import evidence_resource, sample_source

from .live import active_actor


def require_credential(options, service, credential):
    expected = options["service_credentials"].get(service)
    if expected is None or not secrets.compare_digest(expected, credential):
        raise HTTPException(403, "service_credential_required")


_GENERATED_PROJECT_ID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)


def _create_projection(body, path):
    change = body.change
    return (
        body.source_method == "POST"
        and body.source_path == path
        and _GENERATED_PROJECT_ID.fullmatch(change.resource_id) is not None
        and not change.asset_ids
        and change.metadata_asset_ids is None
        and change.carried_asset_ids is None
    )


def _visual_canvas_source(body):
    change = body.change
    path = "/v1/visual-workshop/projects"
    if change.expected_resource_revision == -1:
        return _create_projection(body, path)
    project = f"{path}/{change.resource_id}"
    if change.visual_upload is not None:
        return change.visual_upload.matches_source(
            body.source_method, body.source_path, change.resource_id
        )
    if change.visual_project_removal is not None:
        return (body.source_method, body.source_path) == ("DELETE", project)
    canvas = project + "/canvas"
    outputs = re.fullmatch(re.escape(project) + r"/nodes/[^/]{1,64}/outputs", body.source_path)
    output = re.fullmatch(
        re.escape(project) + r"/nodes/[^/]{1,64}/outputs/[^/]{1,128}", body.source_path
    )
    return canvas_metadata(body.caller, change) and (
        (body.source_method, body.source_path)
        in {("PUT", canvas), ("POST", canvas + "/operations")}
        or (body.source_method == "POST" and outputs is not None)
        or (body.source_method == "DELETE" and output is not None)
    )


def _galgame_file_source(body):
    change = body.change
    scope = change.galgame_file_mutation
    if scope is None:
        return False
    path = f"/v1/galgame-workshop/projects/{scope.project_id}/assets/{change.resource_id}"
    method = "PATCH" if change.resource_kind == "file-name" else "DELETE"
    return body.source_path == path and body.source_method == method


def _galgame_annotation_source(body):
    path = f"/v1/galgame-workshop/projects/{body.change.resource_id}/annotation-imports"
    return (body.caller, body.source_method, body.source_path) == ("galgame", "POST", path)


def _galgame_story_source(body):
    change = body.change
    if change.galgame_project_removal:
        return (
            body.source_method == "DELETE"
            and body.source_path == f"/v1/galgame-workshop/projects/{change.resource_id}"
        )
    if change.expected_resource_revision == -1:
        return _create_projection(body, "/v1/galgame-workshop/projects")
    story_path = f"/v1/galgame-workshop/projects/{change.resource_id}/story"
    if not story_metadata(body.caller, change):
        return False
    if body.source_method == "POST":
        return (
            _galgame_annotation_source(body)
            or body.source_path
            in {
                story_path + "/operations",
                story_path + "/import",
                story_path + "/portrait-upgrade",
                f"/v1/galgame-workshop/projects/{change.resource_id}/assets/repair",
                f"/v1/galgame-workshop/projects/{change.resource_id}/assets/asr/match-dialogue",
            }
            or bool(
                re.fullmatch(
                    re.escape(story_path) + r"/snapshots/[A-Za-z0-9_-]{1,128}/restore",
                    body.source_path,
                )
            )
        )
    return (body.source_method == "PUT" and body.source_path == story_path) or (
        body.source_method == "PATCH"
        and body.source_path
        in {
            story_path + "/edits",
            story_path + "/dialogue",
            story_path + "/stage-expression",
        }
    )


def _annotation_source(body):
    change = body.change
    if change.resource_kind != "project":
        return False
    if change.expected_resource_revision == -1:
        return (
            body.source_method == "POST"
            and body.source_path in PROJECT_CREATION
            and _GENERATED_PROJECT_ID.fullmatch(change.resource_id) is not None
            and len(change.asset_ids) == 1
        )
    return (
        body.source_method == "DELETE"
        and body.source_path == f"{ANNOTATION}/projects/{change.resource_id}"
        and not change.asset_ids
    )


def _project_file_scope_source(body, prefix):
    change = body.change
    if prefix == VIDEO and (rename := change.video_file_rename) is not None:
        path = f"{prefix}/projects/{rename.project_id}/assets/{change.resource_id}"
        return body.source_method == "PATCH" and body.source_path == path
    if prefix == VIDEO and (removal := change.video_file_removal) is not None:
        project = f"{prefix}/projects/{removal.project_id}"
        path = (
            f"{project}/renders/{removal.render_id}"
            if removal.render_id is not None
            else f"{project}/assets/{change.resource_id}"
        )
        return body.source_method == "DELETE" and body.source_path == path
    if change.resource_kind != "project" or change.asset_ids:
        return False
    projects = prefix + "/projects"
    if prefix == VIDEO and (handoff := handoff_target(body.source_method, body.source_path)):
        return (
            handoff[5] == "new"
            and handoff[4] == change.resource_id
            and change.expected_resource_revision == -1
        )
    if change.expected_resource_revision == -1:
        return (
            body.source_method == "POST"
            and body.source_path == projects
            and _GENERATED_PROJECT_ID.fullmatch(change.resource_id) is not None
        )
    return body.source_method == "DELETE" and body.source_path == f"{projects}/{change.resource_id}"


def _presentation_source(body):
    change = body.change
    kind, identity = change.resource_kind, change.resource_id
    method, path = body.source_method, body.source_path
    if kind in PRESENTATION_LIBRARY:
        collection = PRESENTATION_LIBRARY[kind]
        if change.expected_resource_revision == -1:
            return (
                method == "POST"
                and path in {collection, PRESENTATION_BUNDLE}
                and _GENERATED_PROJECT_ID.fullmatch(identity) is not None
            )
        return path == f"{collection}/{identity}" and (
            method == "PUT" or (method == "DELETE" and not change.asset_ids)
        )
    if kind != "project":
        return False
    if change.expected_resource_revision == -1:
        return (
            method == "POST"
            and (
                path in {PRESENTATION, PRESENTATION_IMPORT}
                or any(
                    re.fullmatch(rf"{prefix}/[A-Za-z0-9_-]+/documents", path)
                    for prefix in PRESENTATION_LIBRARY.values()
                )
            )
            and _GENERATED_PROJECT_ID.fullmatch(identity) is not None
        )
    project = f"{PRESENTATION}/{identity}"
    return (
        (method == "PUT" and path == project)
        or (method == "POST" and path in {project + "/operations", project + "/template/apply"})
        or (method == "DELETE" and path == project and not change.asset_ids)
    )


class RetentionAuthorization:
    def __init__(self, state):
        self.state = state
        self.options = state.identity_options

    async def issue(self, body, credential):
        require_credential(self.options, body.caller, credential)
        operation = self.state.service_catalog.match(body.source_method, body.source_path)
        publication_source = (
            re.fullmatch(
                r"/v1/thought-workshop/community/(libraries|publications)/([A-Za-z0-9_-]+)/"
                r"(publication|management)",
                body.source_path,
            )
            if body.caller == "thought" and body.source_method == "PUT"
            else None
        )
        if publication_source and (publication_source[1], publication_source[3]) not in {
            ("libraries", "publication"),
            ("publications", "management"),
        }:
            publication_source = None
        community = body.community
        if (
            community is None
            and body.change.metadata_asset_ids is not None
            and not (
                story_metadata(body.caller, body.change)
                or canvas_metadata(body.caller, body.change)
            )
        ):
            raise HTTPException(403, "retention_metadata_scope_required")
        if body.change.carried_asset_ids is not None and not canvas_metadata(
            body.caller, body.change
        ):
            raise HTTPException(403, "retention_metadata_scope_required")
        if community is not None and (
            body.caller != "thought"
            or not community.matches_source(body.source_method, body.source_path)
            or not community.matches_change(body.change)
        ):
            raise HTTPException(403, "retention_community_scope_mismatch")
        expected_permission = (
            "community.access" if publication_source or community else "content.write"
        )
        assistant_message = message_source(body.source_method, body.source_path)
        if assistant_message and body.change.visual_conversation_project is not None:
            expected_permission = "models.use"
        review_start = visual_review_start(body.source_method, body.source_path)
        review = body.change.visual_review_project
        evidence = body.change.visual_evidence
        if review_start and (review or evidence is not None):
            expected_permission = "models.use"
        upload = body.change.visual_upload
        if upload is not None and upload.from_model_request(body.source_method, body.source_path):
            expected_permission = "models.use"
        handoff = body.caller == "video" and handoff_target(body.source_method, body.source_path)
        if not handoff and (
            operation is None
            or operation.service != body.caller
            or route_permission(body.source_method, body.source_path) != expected_permission
        ):
            raise HTTPException(403, "retention_source_forbidden")
        if (
            body.caller == "visual"
            and body.change.resource_kind == "canvas"
            and not _visual_canvas_source(body)
        ):
            raise HTTPException(403, "retention_resource_mismatch")
        if (
            body.caller == "visual"
            and body.change.resource_kind == "conversation"
            and not conversation_retention(body)
        ):
            raise HTTPException(403, "retention_resource_mismatch")
        if evidence is not None:
            sample = sample_source(body.source_method, body.source_path)
            matching = (
                sample
                and (sample[1], evidence_resource(sample[2]))
                == (evidence.project_id, body.change.resource_id)
            ) or (
                review_start
                and review_start[1] == evidence.project_id
                and body.change.resource_id.startswith("run-")
            )
            if body.caller != "visual" or not matching:
                raise HTTPException(403, "retention_resource_mismatch")
        if review is not None and (
            body.caller != "visual"
            or not review_start
            or review_start[1] != review
            or not body.change.resource_id.startswith("run-")
        ):
            raise HTTPException(403, "retention_resource_mismatch")
        if body.caller == "galgame" and not (
            (body.change.resource_kind == "story" and _galgame_story_source(body))
            or _galgame_file_source(body)
        ):
            raise HTTPException(403, "retention_resource_mismatch")
        if body.caller in {"motion", "video"} and not _project_file_scope_source(
            body, MOTION if body.caller == "motion" else VIDEO
        ):
            raise HTTPException(403, "retention_resource_mismatch")
        if body.caller == "presentation" and not _presentation_source(body):
            raise HTTPException(403, "retention_resource_mismatch")
        if body.caller == "annotation" and not _annotation_source(body):
            raise HTTPException(403, "retention_resource_mismatch")
        if body.caller == "thought":
            # An original write is not by itself authority to change an arbitrary
            # source resource. Admit only operations whose path binds the exact ID.
            direct = (
                re.fullmatch(
                    r"/v1/thought-workshop/(notes|templates)/([A-Za-z0-9_-]+)", body.source_path
                )
                if body.source_method in {"PUT", "DELETE"}
                else None
            )
            knowledge_update = (
                re.fullmatch(
                    r"/v1/thought-workshop/knowledge-bases/([A-Za-z0-9_-]+)", body.source_path
                )
                if body.source_method == "PUT" and body.change.expected_resource_revision >= 0
                else None
            )
            note_operation = (
                re.fullmatch(
                    r"/v1/thought-workshop/notes/([A-Za-z0-9_-]+)/"
                    r"(?:operations|history/[A-Za-z0-9_-]+/restore|multitable/operations|"
                    r"multitable/history/[0-9]+/restore|"
                    r"multitable/tables/[A-Za-z0-9_-]+/csv-import)",
                    body.source_path,
                )
                if body.source_method == "POST"
                else None
            )
            initial_id = (
                re.fullmatch(
                    r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                    body.change.resource_id,
                )
                is not None
            )
            new_template = (
                body.source_method == "POST"
                and body.source_path == "/v1/thought-workshop/templates"
                and body.change.resource_kind == "template"
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            create_knowledge_base = (
                body.source_method == "POST"
                and body.source_path == "/v1/thought-workshop/knowledge-bases"
                and body.change.resource_kind in {"knowledge-base", "note"}
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            official_import = (
                body.source_method == "POST"
                and body.source_path == "/v1/thought-workshop/community/official-import"
                and body.change.resource_kind in {"knowledge-base", "note", "template"}
                and body.change.expected_resource_revision == -1
                and not body.change.asset_ids
                and initial_id
            )
            apply_template = (
                body.source_method == "POST"
                and re.fullmatch(
                    r"/v1/thought-workshop/templates/[A-Za-z0-9_-]+/apply", body.source_path
                )
                is not None
                and body.change.resource_kind == "note"
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            create_note = (
                body.source_method == "POST"
                and (
                    body.source_path == "/v1/thought-workshop/notes"
                    or re.fullmatch(
                        r"/v1/thought-workshop/knowledge-bases/[A-Za-z0-9_-]+/documents",
                        body.source_path,
                    )
                    is not None
                    or re.fullmatch(
                        r"/v1/thought-workshop/notes/[A-Za-z0-9_-]+/duplicate",
                        body.source_path,
                    )
                    is not None
                )
                and body.change.resource_kind == "note"
                and body.change.expected_resource_revision == -1
                and initial_id
            )
            if community:
                expected_kind, expected_id = "note", community.note_id
            elif publication_source:
                # The library operation resolves its publication in Thought's owned registry.
                # The management operation already carries the exact publication in its path.
                expected_kind = "publication"
                expected_id = (
                    publication_source[2]
                    if publication_source[1] == "publications"
                    else body.change.resource_id
                )
                initial = body.change.expected_resource_revision == -1
                if len(body.change.asset_ids) > 1 or (
                    initial and (publication_source[1] != "libraries" or not initial_id)
                ):
                    raise HTTPException(403, "retention_resource_mismatch")
            elif (
                new_template
                or apply_template
                or create_note
                or create_knowledge_base
                or official_import
            ):
                expected_kind = (
                    "template"
                    if new_template
                    else body.change.resource_kind
                    if create_knowledge_base or official_import
                    else "note"
                )
                expected_id = body.change.resource_id
            elif direct:
                expected_kind = "note" if direct.group(1) == "notes" else "template"
                expected_id = direct.group(2)
            elif knowledge_update:
                expected_kind, expected_id = "knowledge-base", knowledge_update.group(1)
            elif note_operation:
                expected_kind, expected_id = "note", note_operation.group(1)
            else:
                raise HTTPException(403, "retention_source_forbidden")
            if body.change.resource_kind != expected_kind or body.change.resource_id != expected_id:
                raise HTTPException(403, "retention_resource_mismatch")
        try:
            body.change.validate_service(body.caller)
            actor = verify_context(
                body.assertion,
                service=body.caller,
                method=body.source_method,
                path=body.source_path,
                public_key=self.options["private_key"].public_key(),
                # Re-admit only the exact saved job while its Session or key is still active.
                allow_expired=(
                    _galgame_annotation_source(body) or body.change.visual_upload is not None
                ),
            )
        except (jwt.InvalidTokenError, ValueError, TypeError) as exc:
            raise HTTPException(401, "invalid_source_assertion") from exc
        principal = StudioPrincipal(
            user_id=actor.user_id,
            must_change_password=False,
            platform_role=actor.platform_role,
            auth_kind=actor.auth_kind,
            scopes=frozenset(actor.scopes),
        )
        permitted = (
            actor.auth_kind == "session" and principal.permits("studio:read")
            if publication_source or community
            else principal.allows(expected_permission) and principal.permits("studio:write")
        )
        if (
            not permitted
            or (community is not None and actor.user_id != community.actor_id)
            or (
                review_start
                and (review or evidence is not None)
                and not principal.allows("content.write")
            )
        ):
            raise HTTPException(403, "retention_source_forbidden")
        if body.source_path == "/v1/thought-workshop/community/official-import" and (
            actor.auth_kind != "session" or actor.platform_role != "admin"
        ):
            raise HTTPException(403, "retention_source_forbidden")
        async with self.state.database.sessions() as session:
            if not await active_actor(session, actor):
                raise HTTPException(401, "source_authorization_revoked")
        return issue_retention(
            actor,
            caller=body.caller,
            change=body.change,
            community=community,
            private_key=self.options["private_key"],
            key_id=self.options["key_id"],
        )

    async def can_prepare(self, token, credential, *, sealed_visual_upload=False):
        require_credential(self.options, "assets", credential)
        try:
            authority = verify_retention(token, public_key=self.options["private_key"].public_key())
        except (jwt.InvalidTokenError, ValueError, TypeError, KeyError) as exc:
            raise HTTPException(401, "invalid_retention_authority") from exc
        if sealed_visual_upload:
            if authority.caller != "visual":
                return False
        elif authority.prepare_before <= time.time():
            return False
        async with self.state.database.sessions() as session:
            return await active_actor(session, authority.actor)
