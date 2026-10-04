import { expect, type Page } from "@playwright/test";
import type { components } from "../src/generated/api";
export const root = "/v1/thought-workshop",
  community = root + "/community";
export async function write(
  page: Page,
  path: string,
  data: unknown,
  method = "POST",
) {
  const response = await page.request.fetch(path, {
    method,
    data,
    headers: {
      Origin: `http://127.0.0.1:${process.env.FPL_E2E_WEB_PORT || "3000"}`,
      "X-CSRF-Token":
        (await page.context().cookies()).find((c) => c.name === "fpl_csrf")
          ?.value || "",
    },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json();
}
export async function importAndPublish(
  page: Page,
  libraryKey: string,
  requestId = crypto.randomUUID(),
) {
  const preview = await (
    await page.request.get(community + "/official-import/preview")
  ).json();
  const imported: components["schemas"]["ThoughtImportOut"] = await write(
    page,
    community + "/official-import",
    { request_id: requestId, package_version: preview.package_version },
  );
  const publications = [];
  for (const id of imported.knowledge_base_ids ?? []) {
    const directory: components["schemas"]["ThoughtDirectoryOut"] = await (
      await page.request.get(root + `/knowledge-bases/${id}/directory`)
    ).json();
    const pub = await write(
      page,
      community + `/libraries/${id}/publication`,
      {
        expected_revision: 0,
        title: directory.knowledge_base.title,
        is_official: true,
        read_only: true,
        editable_platform_roles: ["super_admin", "admin"],
        articles: [
          ...directory.documents,
          { id: directory.knowledge_base.home_note_id },
        ].map((n) => ({ note_id: n.id, expected_revision: 0 })),
      },
      "PUT",
    );
    publications.push(pub.publication);
  }
  const resolved = await (
    await page.request.get(community + `/official-links/${libraryKey}`)
  ).json();
  const selected = resolved.find((target: { publication: { id: string } }) =>
    publications.some((p) => p.id === target.publication.id),
  );
  return {
    imported,
    publications: publications as components["schemas"]["PublicationOut"][],
    publication:
      selected.publication as components["schemas"]["PublicationOut"],
    home: selected.note_id as string,
  };
}
export async function legacyTarget(
  page: Page,
  library: string,
  document: string,
  publication?: string,
) {
  const rows = await (
    await page.request.get(
      community + `/official-links/${library}?document_key=${document}`,
    )
  ).json();
  return publication
    ? rows.find(
        (r: { publication: { id: string } }) =>
          r.publication.id === publication,
      )
    : rows[0];
}
