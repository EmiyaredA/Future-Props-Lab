import { api, unwrap } from "@platform/api/client";

export async function createSupplier(
  input: { name: string },
  revision: number,
) {
  return unwrap(
    await api.POST("/v1/model-suppliers", {
      body: { ...input, expected_catalog_revision: revision },
    }),
  );
}
export async function updateSupplier(
  id: string,
  input: { name: string },
  revision: number,
) {
  return unwrap(
    await api.PATCH("/v1/model-suppliers/{supplier_id}", {
      params: { path: { supplier_id: id } },
      body: { ...input, expected_catalog_revision: revision },
    }),
  );
}
export async function deleteSupplier(id: string, revision: number) {
  return unwrap(
    await api.DELETE("/v1/model-suppliers/{supplier_id}", {
      params: {
        path: { supplier_id: id },
        query: { expected_catalog_revision: revision },
      },
    }),
  );
}
