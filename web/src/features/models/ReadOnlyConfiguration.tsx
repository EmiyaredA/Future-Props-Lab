import "@shared/ui/read-only-page.css";
import { useQuery } from "@tanstack/react-query";
import { getModelTestTools } from "./api";
import { modelQueryKeys } from "./queryKeys";
import { ModelServicePage } from "./catalog";
export function ReadOnlyConfiguration({ tools = false }: { tools?: boolean }) {
  const toolList = useQuery({
    queryKey: modelQueryKeys.tools,
    queryFn: getModelTestTools,
    enabled: tools,
  });
  if (!tools) return <ModelServicePage canWrite={false} />;
  return (
    <section className="readonly-page">
      <h1>测试工具</h1>
      <p>当前角色可以查看配置，修改配置需要工作区管理员权限。</p>
      {toolList.error && <p role="alert">无法加载配置，请刷新重试。</p>}
      {toolList.data?.items.map((tool) => (
        <article key={tool.id}>
          <h2>{tool.name}</h2>
          <p>{tool.description}</p>
        </article>
      ))}
    </section>
  );
}
