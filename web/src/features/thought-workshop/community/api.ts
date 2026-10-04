import { api, unwrap } from "@platform/api/client";
import type { components } from "@generated/api";
import { read, type NoteInput } from "../api";
export type Publication = components["schemas"]["PublicationOut"];
export type CommunityDirectory = components["schemas"]["CommunityDirectory"];
export type ArticleConfig = components["schemas"]["ArticleConfig"];
export type ArticleSetting = components["schemas"]["ArticleSetting"];
export type PublishInput = components["schemas"]["PublishInput"];
export const listPublications = (
  query: string,
  mine: boolean,
  favorites: boolean,
  offset = 0,
  signal?: AbortSignal,
  official?: boolean,
) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET("/v1/thought-workshop/community/publications", {
          params: {
            query: { query, mine, favorites, offset, limit: 24, official },
          },
          signal,
        }),
      ),
    signal,
  );
export const getCommunityDirectory = (
  publication_id: string,
  signal?: AbortSignal,
) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET(
          "/v1/thought-workshop/community/publications/{publication_id}",
          { params: { path: { publication_id } }, signal },
        ),
      ),
    signal,
  );
export const getCommunityNote = (
  publication_id: string,
  note_id: string,
  signal?: AbortSignal,
) =>
  read(
    async (signal) =>
      unwrap(
        await api.GET(
          "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}",
          { params: { path: { publication_id, note_id } }, signal },
        ),
      ),
    signal,
  );
export const saveCommunityNote = async (
  publication_id: string,
  note_id: string,
  body: NoteInput,
  expected_revision: number,
) =>
  unwrap(
    await api.PUT(
      "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}",
      {
        params: { path: { publication_id, note_id } },
        body: {
          title: body.title,
          document: body.document ?? { type: "doc", content: [] },
          tags: body.tags,
          schema_version: body.schema_version,
          expected_revision,
        },
      },
    ),
  );
export const getPublicationConfig = async (library_id: string) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/community/libraries/{library_id}/publication",
      { params: { path: { library_id } } },
    ),
  );
export const publishLibrary = async (library_id: string, body: PublishInput) =>
  unwrap(
    await api.PUT(
      "/v1/thought-workshop/community/libraries/{library_id}/publication",
      { params: { path: { library_id } }, body },
    ),
  );
export const getArticlePermissions = async (
  publication_id: string,
  note_id: string[],
) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/community/publications/{publication_id}/permissions",
      { params: { path: { publication_id }, query: { note_id } } },
    ),
  );
export const setArticlePermissions = async (
  publication_id: string,
  articles: ArticleSetting[],
) =>
  unwrap(
    await api.PUT(
      "/v1/thought-workshop/community/publications/{publication_id}/permissions",
      { params: { path: { publication_id } }, body: { articles } },
    ),
  );
export const listFavorites = async () =>
  unwrap(await api.GET("/v1/thought-workshop/community/favorites"));
export const setFavorite = async (resource_id: string, favorite: boolean) =>
  unwrap(
    await api.PUT(
      "/v1/thought-workshop/community/favorites/{namespace}/{resource_id}",
      {
        params: {
          path: {
            namespace: resource_id.split("/")[0],
            resource_id: resource_id.split("/")[1],
          },
        },
        body: { favorite },
      },
    ),
  );
export const communityAssetUrl = (
  publication: string,
  id: string,
  note?: string,
) =>
  `/v1/thought-workshop/community/publications/${encodeURIComponent(publication)}/assets/${encodeURIComponent(id)}/content${note ? `?note_id=${encodeURIComponent(note)}` : ""}`;
export const uploadCommunityFile = async (
  publication_id: string,
  note_id: string,
  file: File,
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}/uploads",
      {
        params: { path: { publication_id, note_id } },
        body: { upload: file as unknown as string },
        bodySerializer() {
          const form = new FormData();
          form.set("upload", file);
          return form;
        },
      },
    ),
  );
export const communitySnapshot = async (publication_id: string) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/community/publications/{publication_id}/export-snapshot",
      { params: { path: { publication_id } } },
    ),
  );

export const getCommunityManagement = async (publication_id: string) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/community/publications/{publication_id}/management",
      { params: { path: { publication_id } } },
    ),
  );
export const manageCommunityPublication = async (
  publication_id: string,
  body: PublishInput,
) =>
  unwrap(
    await api.PUT(
      "/v1/thought-workshop/community/publications/{publication_id}/management",
      { params: { path: { publication_id } }, body },
    ),
  );

export const communityBacklinks = async (
  publication_id: string,
  note_id: string,
  offset = 0,
) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/community/publications/{publication_id}/notes/{note_id}/backlinks",
      {
        params: {
          path: { publication_id, note_id },
          query: { offset, limit: 40 },
        },
      },
    ),
  );

export const getOfficialImportPreview = async () =>
  unwrap(
    await api.GET("/v1/thought-workshop/community/official-import/preview"),
  );
export const importOfficialNotes = async (
  body: components["schemas"]["SeedImportInput"],
) =>
  unwrap(
    await api.POST("/v1/thought-workshop/community/official-import", { body }),
  );
export const getOfficialImportReceipt = async (request_id: string) =>
  api.GET("/v1/thought-workshop/community/official-import/{request_id}", {
    params: { path: { request_id } },
  });
export const resolveOfficialLink = async (
  library_key: string,
  document_key = "",
) =>
  unwrap(
    await api.GET(
      "/v1/thought-workshop/community/official-links/{library_key}",
      { params: { path: { library_key }, query: { document_key } } },
    ),
  );

export const resolveCommunityReferences = async (
  publication_id: string,
  ids: string[],
  signal?: AbortSignal,
) =>
  unwrap(
    await api.POST(
      "/v1/thought-workshop/community/publications/{publication_id}/references",
      { params: { path: { publication_id } }, body: { ids }, signal },
    ),
  );
