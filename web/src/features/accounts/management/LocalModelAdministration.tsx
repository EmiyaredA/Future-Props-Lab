import { useQuery } from "@tanstack/react-query";
import { getCatalog, LocalModelsPanel, modelQueryKeys } from "@features/models";
import { useRuntimeAccess } from "../useRuntimeAccess";

export function LocalModelAdministration() {
  const local = useRuntimeAccess();
  const catalog = useQuery({
    queryKey: modelQueryKeys.catalogFor("management-native"),
    queryFn: getCatalog,
  });
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h2>本地模型服务</h2>
          <p>安装与运行由本机管理入口维护。各账号在模型页面添加自己的接入。</p>
        </div>
      </header>
      {catalog.isError ? (
        <p role="alert">模型服务暂不可用，请检查所属服务后重试。</p>
      ) : catalog.data ? (
        <LocalModelsPanel
          catalog={catalog.data}
          canWrite={false}
          allowHostManagement={local}
        />
      ) : (
        <p role="status">正在读取本地模型…</p>
      )}
    </section>
  );
}
