import { type TransferOptions } from "@platform/api/transfer";
import { fetchApiJson, requestApi } from "@platform/api/client";

export type CreativeKind = "tool_api" | "mcp" | "skill" | "bundle";
export type CreativeStatus = "draft" | "published" | "withdrawn";
export type CreativeItem = {
  id: string;
  kind: CreativeKind;
  status: CreativeStatus;
  title: string;
  summary: string;
  description: string;
  tags: string[];
  cover_preset: string;
  cover_url: string | null;
  manifest: Record<string, unknown>;
  components: string[];
  revision: number;
  author_user_id: string;
  author_name: string;
  origin_owner_user_id: string;
  current_release_id: string | null;
  version: number | null;
  installable: boolean;
  created_at: string;
  updated_at: string;
};
export type CreativeRelease = Omit<
  CreativeItem,
  | "status"
  | "revision"
  | "author_user_id"
  | "origin_owner_user_id"
  | "current_release_id"
  | "updated_at"
> & {
  item_id: string;
  version: number;
};
export type CreativeDraft = Pick<
  CreativeItem,
  | "kind"
  | "title"
  | "summary"
  | "description"
  | "tags"
  | "cover_preset"
  | "manifest"
  | "components"
>;
export type InstallPart = {
  release_id: string;
  kind: Exclude<CreativeKind, "bundle">;
  title: string;
  target_name: string;
  conflict: boolean;
  already_installed: boolean;
  pending_setup: boolean;
};
export type InstallPreview = {
  release_id: string;
  parts: InstallPart[];
  installable: boolean;
};

const base = "/v1/creative-workshop";
const json = (body: unknown) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function listCreative(
  params: { mine?: boolean; kind?: string; q?: string; cursor?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.mine) query.set("mine", "true");
  if (params.kind && params.kind !== "all") query.set("kind", params.kind);
  if (params.q) query.set("q", params.q);
  if (params.cursor) query.set("cursor", params.cursor);
  return fetchApiJson<{ items: CreativeItem[]; next_cursor: string | null }>(
    `${base}/items?${query}`,
  );
}
export const getCreative = (id: string, draft = false) =>
  fetchApiJson<CreativeItem>(
    `${base}/items/${encodeURIComponent(id)}${draft ? "?draft=true" : ""}`,
  );
export const getCreativeRelease = (id: string) =>
  fetchApiJson<CreativeRelease>(`${base}/releases/${encodeURIComponent(id)}`);
export const createCreative = (draft: CreativeDraft) =>
  fetchApiJson<CreativeItem>(`${base}/items`, {
    method: "POST",
    ...json(draft),
  });
export const updateCreative = (
  id: string,
  draft: CreativeDraft,
  expected_revision: number,
) =>
  fetchApiJson<CreativeItem>(`${base}/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    ...json({ ...draft, expected_revision }),
  });
export const publishCreative = (id: string, expected_revision: number) =>
  fetchApiJson<CreativeItem>(
    `${base}/items/${encodeURIComponent(id)}/publish`,
    {
      method: "POST",
      ...json({ expected_revision }),
    },
  );
export const withdrawCreative = (id: string, expected_revision: number) =>
  fetchApiJson<CreativeItem>(
    `${base}/items/${encodeURIComponent(id)}/withdraw`,
    {
      method: "POST",
      ...json({ expected_revision }),
    },
  );
export const importCreative = (kind: CreativeKind, source_id: string) =>
  fetchApiJson<CreativeItem>(`${base}/items/from-integration`, {
    method: "POST",
    ...json({ kind, source_id }),
  });
export async function uploadCreative(
  id: string,
  revision: number,
  file: File,
  kind: "cover" | "skill-archive",
  transfer: TransferOptions = {},
) {
  const form = new FormData();
  form.set("expected_revision", String(revision));
  form.set("file", file);
  return fetchApiJson<CreativeItem>(
    `${base}/items/${encodeURIComponent(id)}/${kind}`,
    { ...transfer, method: "POST", body: form },
  );
}
export const previewInstall = (
  release_id: string,
  names: Record<string, string>,
) =>
  fetchApiJson<InstallPreview>(`${base}/installations/preview`, {
    method: "POST",
    ...json({ release_id, names }),
  });
export const installCreative = (
  release_id: string,
  names: Record<string, string>,
) =>
  fetchApiJson<{
    id: string;
    resources: { release_id: string; state: string; name: string }[];
    already_installed: boolean;
  }>(`${base}/installations`, {
    method: "POST",
    ...json({ release_id, names }),
  });
export const configureStdio = (
  installationId: string,
  release_id: string,
  command: string,
  arguments_: string[],
) =>
  fetchApiJson<{
    id: string;
    resources: { release_id: string; state: string; name: string }[];
  }>(`${base}/installations/${encodeURIComponent(installationId)}/stdio`, {
    method: "POST",
    ...json({ release_id, command, arguments: arguments_, environment: {} }),
  });
export async function creativeCoverBlob(url: string) {
  return (await requestApi(url)).blob();
}
