import { LoadingState } from "@shared/ui/LoadingState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TemplateDesigner } from "./TemplateDesigner";
import { getTemplate } from "./api";
import { presentationKeys } from "../queryKeys";
import type { NavigationGuard } from "../types";
export function TemplateDesignerPage({
  id,
  onBack,
  onOpen,
  readOnly,
  registerNavigationGuard,
}: {
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  readOnly: boolean;
  registerNavigationGuard?: NavigationGuard;
}) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: presentationKeys.template(id),
    queryFn: () => getTemplate(id),
    enabled: id !== "new",
  });
  if (id !== "new" && query.isPending)
    return (
      <LoadingState
        label="正在打开模板…"
        variant="region"
        className="presentation-loading"
      />
    );
  if (id !== "new" && query.isError)
    return (
      <div className="presentation-loading" role="alert">
        模板加载失败
        <button className="btn" onClick={() => void query.refetch()}>
          重试
        </button>
        <button className="btn" onClick={onBack}>
          返回模板库
        </button>
      </div>
    );
  return (
    <TemplateDesigner
      key={id}
      initial={id === "new" ? null : (query.data ?? null)}
      readOnly={readOnly}
      onClose={onBack}
      registerNavigationGuard={registerNavigationGuard}
      onSaved={(template) => {
        cache.setQueryData(presentationKeys.template(template.id), template);
        void cache.invalidateQueries({ queryKey: presentationKeys.templates });
        if (id === "new") onOpen(template.id);
      }}
    />
  );
}
