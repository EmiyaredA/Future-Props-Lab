import type {
  ModelCategory,
  ModelEntry,
  ModelInput,
  Provider,
  ProviderInput,
} from "@features/models/api";

export type CatalogOrigin = {
  origin?: "user" | "role_template";
  template_key?: string | null;
  managed_fields?: string[];
};
export type CatalogSupplier = CatalogOrigin & { id: string; name: string };
export type CatalogModel = Omit<ModelEntry, keyof CatalogOrigin> &
  CatalogOrigin;
export type CatalogProvider = Omit<Provider, "models" | keyof CatalogOrigin> &
  CatalogOrigin & {
    supplier_id?: string | null;
    models: CatalogModel[];
  };
export type CatalogProviderInput = ProviderInput & {
  supplier_id?: string | null;
};
export type ModelCatalogValue = {
  suppliers: CatalogSupplier[];
  providers: CatalogProvider[];
  default_model_ids?: Partial<
    Record<ModelEntry["capabilities"][number], string>
  >;
};
type Result = void | Promise<void>;
export type ModelCatalogActions = {
  createSupplier: (input: { name: string }) => Result;
  updateSupplier: (id: string, input: { name: string }) => Result;
  deleteSupplier: (id: string) => Result;
  ensureProtocolType: (name: string) => Promise<string>;
  organizeByProtocolKind: () => Result;
  createProvider: (input: CatalogProviderInput) => Result;
  updateProvider: (id: string, input: CatalogProviderInput) => Result;
  deleteProvider: (id: string) => Result;
  setProviderEnabled: (id: string, enabled: boolean) => Result;
  createModel: (providerId: string, input: ModelInput) => Result;
  updateModel: (id: string, input: ModelInput) => Result;
  deleteModel: (id: string) => Result;
  setModelEnabled: (id: string, enabled: boolean) => Result;
};
export type CatalogEntity = CatalogSupplier | CatalogProvider | CatalogModel;
export type ModelCatalogPermissions = {
  canWrite: boolean;
  canTest?: boolean;
  canEditField?: (entity: CatalogEntity, field: string) => boolean;
  canDelete?: (entity: CatalogEntity) => boolean;
};
export type ModelCatalogEditorProps = {
  value: ModelCatalogValue;
  categories: ModelCategory[];
  actions: ModelCatalogActions;
  permissions: ModelCatalogPermissions;
  onTestModel?: (model: CatalogModel, provider: CatalogProvider) => void;
  advancedInfo?: string;
  onRefresh?: () => void | Promise<void>;
};

export function canEditField(
  permissions: ModelCatalogPermissions,
  entity: CatalogEntity | null,
  field: string,
) {
  if (!permissions.canWrite) return false;
  if (!entity) return true;
  return (
    permissions.canEditField?.(entity, field) ??
    !entity.managed_fields?.includes(field)
  );
}
export function canDeleteEntity(
  permissions: ModelCatalogPermissions,
  entity: CatalogEntity,
) {
  return (
    permissions.canWrite &&
    (permissions.canDelete?.(entity) ?? entity.origin !== "role_template")
  );
}
