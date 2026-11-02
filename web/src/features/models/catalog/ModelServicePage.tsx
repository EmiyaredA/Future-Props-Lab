import { LocalModelsPanel } from "./LocalModelsPanel";
import type { ReactNode } from "react";
import { AccountDefaults } from "./AccountDefaults";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryFeedback } from "@shared/ui/QueryFeedback";
import { ApiError } from "@platform/api/client";
import {
  addModel,
  createProvider,
  deleteModel,
  deleteProvider,
  getCatalog,
  getModelCategories,
  setProviderEnabled,
  updateModel,
  updateProvider,
  type Catalog,
} from "@features/models/api";
import { modelQueryKeys } from "@features/models/queryKeys";
import { ModelCatalogEditor } from "./ModelCatalogEditor";
import { createSupplier, deleteSupplier, updateSupplier } from "./supplierApi";
import type {
  ModelCatalogActions,
  ModelCatalogEditorProps,
} from "./catalogTypes";

export function ModelServicePage({
  canWrite = true,
  canTest = false,
  onTestModel,
  renderHeader,
}: {
  canWrite?: boolean;
  canTest?: boolean;
  onTestModel?: ModelCatalogEditorProps["onTestModel"];
  renderHeader?: (actions: ReactNode) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: modelQueryKeys.catalog,
    queryFn: getCatalog,
  });
  const categories = useQuery({
    queryKey: modelQueryKeys.categories,
    queryFn: getModelCategories,
  });
  const mutate = async <T,>(
    operation: (revision: number) => Promise<T>,
  ): Promise<T> => {
    if (!canWrite || !catalog.data) throw new Error("当前没有修改配置的权限");
    try {
      const result = await operation(catalog.data.revision);
      await queryClient.invalidateQueries({ queryKey: modelQueryKeys.catalog });
      return result;
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.problem.code === "revision_conflict" &&
        cause.problem.current
      ) {
        queryClient.setQueryData(
          modelQueryKeys.catalog,
          cause.problem.current as Catalog,
        );
        void queryClient.invalidateQueries({
          queryKey: modelQueryKeys.catalog,
        });
        throw new Error(
          "目录已被其他操作更新，已载入最新目录。输入已保留，请核对后重新保存。",
        );
      }
      throw cause;
    }
  };
  const run = async (operation: (revision: number) => Promise<unknown>) => {
    await mutate(operation);
  };
  const actions: ModelCatalogActions = {
    createSupplier: (input) =>
      run((revision) => createSupplier(input, revision)),
    updateSupplier: (id, input) =>
      run((revision) => updateSupplier(id, input, revision)),
    deleteSupplier: (id) => run((revision) => deleteSupplier(id, revision)),
    createProvider: async (input) => {
      const result = await mutate((revision) =>
        createProvider(input, revision),
      );
      return { id: result.provider.id };
    },
    updateProvider: (id, input) =>
      run((revision) => updateProvider(id, input, revision)),
    deleteProvider: (id) => run((revision) => deleteProvider(id, revision)),
    setProviderEnabled: (id, enabled) =>
      run((revision) => setProviderEnabled(id, enabled, revision)),
    createModel: (id, input) =>
      run((revision) => addModel(id, input, revision)),
    updateModel: (id, input) =>
      run((revision) => updateModel(id, input, revision)),
    deleteModel: (id) => run((revision) => deleteModel(id, revision)),
    setModelEnabled: (id, enabled) =>
      run((revision) => {
        const model = catalog.data?.providers
          .flatMap((provider) => provider.models)
          .find((item) => item.id === id);
        if (!model) throw new Error("模型已被删除，请刷新目录");
        return updateModel(
          id,
          {
            slug: model.slug,
            label: model.label,
            description: model.description,
            capabilities: model.capabilities,
            categories: model.categories,
            enabled,
          },
          revision,
        );
      }),
  };
  return (
    <section
      className={`page model-service-page${renderHeader ? " model-infrastructure-page" : ""}`}
    >
      {renderHeader ? (
        renderHeader(
          catalog.data && (
            <AccountDefaults catalog={catalog.data} canWrite={canWrite} />
          ),
        )
      ) : (
        <header className="page-header">
          <div>
            <h1>模型服务</h1>
            <p>按用途发现模型，按协议类型浏览接入连接。</p>
          </div>
          {catalog.data && (
            <AccountDefaults catalog={catalog.data} canWrite={canWrite} />
          )}
        </header>
      )}
      <div
        className="model-service-content"
        id={renderHeader ? "model-infrastructure-content" : undefined}
        role={renderHeader ? "tabpanel" : undefined}
        aria-labelledby={
          renderHeader ? "infrastructure-tab-model-service" : undefined
        }
      >
        <QueryFeedback
          error={catalog.error ?? categories.error}
          onRetry={() => {
            void catalog.refetch();
            void categories.refetch();
          }}
        />
        {catalog.isPending || categories.isPending ? (
          <p role="status">正在加载模型目录…</p>
        ) : (
          catalog.data &&
          categories.data && (
            <ModelCatalogEditor
              value={{
                ...catalog.data,
                suppliers: catalog.data.suppliers ?? [],
              }}
              categories={categories.data.items}
              actions={actions}
              permissions={{ canWrite, canTest }}
              onTestModel={onTestModel}
              renderLocalModels={(onOpenConnection) =>
                catalog.data && (
                  <LocalModelsPanel
                    catalog={catalog.data}
                    canWrite={canWrite}
                    canTest={canTest}
                    onTestModel={onTestModel}
                    onOpenConnection={onOpenConnection}
                  />
                )
              }
              advancedInfo={`目录版本 ${catalog.data.revision}`}
              onRefresh={async () => {
                await catalog.refetch({ throwOnError: true });
              }}
            />
          )
        )}
      </div>
    </section>
  );
}
