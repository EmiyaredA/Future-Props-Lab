import { providerKindLabel, type ProviderKind } from "@features/models/metadata";
import type {
  CatalogProvider,
  CatalogProviderInput,
  CatalogSupplier,
  ModelCatalogValue,
} from "./catalogTypes";

export function protocolTypeNameForKind(kind: ProviderKind | string): string {
  return (
    providerKindLabel[kind as ProviderKind] ??
    (typeof kind === "string" ? kind : "未知协议")
  );
}

export function findSupplierIdByName(
  suppliers: CatalogSupplier[],
  name: string,
): string | undefined {
  return suppliers.find((supplier) => supplier.name === name)?.id;
}

export function planOrganizeByProtocol(value: ModelCatalogValue): {
  groupsToCreate: string[];
  assignments: { provider: CatalogProvider; supplierName: string }[];
} {
  const ungrouped = value.providers.filter((provider) => !provider.supplier_id);
  const namesNeeded = [
    ...new Set(
      ungrouped.map((provider) => protocolTypeNameForKind(provider.kind)),
    ),
  ];
  const existing = new Set(value.suppliers.map((supplier) => supplier.name));
  return {
    groupsToCreate: namesNeeded.filter((name) => !existing.has(name)),
    assignments: ungrouped.map((provider) => ({
      provider,
      supplierName: protocolTypeNameForKind(provider.kind),
    })),
  };
}

export function providerUpdateInput(
  provider: CatalogProvider,
  supplierId: string | null,
): CatalogProviderInput {
  return {
    name: provider.name,
    kind: provider.kind,
    base_url: provider.base_url,
    api_key: "",
    enabled: provider.enabled,
    supplier_id: supplierId,
  };
}
