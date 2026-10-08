import type { components } from "@generated/api";
import { api, unwrap } from "@platform/api/client";

export type ExternalConnection = components["schemas"]["ExternalConnectionOut"];
export type ExternalConnectionInput =
  components["schemas"]["ExternalConnectionInput"];
export const getExternalConnections = async () =>
  unwrap(await api.GET("/v1/integrations/external-connections"));
export const createExternalConnection = async (body: ExternalConnectionInput) =>
  unwrap(await api.POST("/v1/integrations/external-connections", { body }));
export const updateExternalConnection = async (
  current: ExternalConnection,
  body: ExternalConnectionInput,
) =>
  unwrap(
    await api.PATCH("/v1/integrations/external-connections/{connection_id}", {
      params: { path: { connection_id: current.id } },
      body: { ...body, expected_revision: current.revision },
    }),
  );
export const checkExternalConnection = async (id: string) =>
  unwrap(
    await api.POST(
      "/v1/integrations/external-connections/{connection_id}/check",
      { params: { path: { connection_id: id } } },
    ),
  );
export const checkExternalTarget = async (id: string, url: string) =>
  unwrap(
    await api.POST(
      "/v1/integrations/external-connections/{connection_id}/target-check",
      { params: { path: { connection_id: id } }, body: { url } },
    ),
  );
