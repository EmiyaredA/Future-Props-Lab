import { Bot, Server } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { StudioPage } from "@app/routes";
import "./model-infrastructure.css";

type ModelView = Extract<StudioPage, "model-service" | "code-agents">;
const views = [
  { page: "model-service", label: "模型服务", icon: Server },
  { page: "code-agents", label: "编程智能体", icon: Bot },
] as const;

export function ModelInfrastructureHeader({
  page,
  navigate,
  actions,
  focusSelected = false,
}: {
  page: ModelView;
  navigate: (page: ModelView, keyboard?: boolean) => void;
  actions: ReactNode;
  focusSelected?: boolean;
}) {
  const selectedTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusSelected) selectedTab.current?.focus();
  }, [focusSelected, page]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 1
          : page === "model-service"
            ? 1
            : 0;
    const buttons =
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]");
    buttons[index]?.focus();
    if (views[index].page !== page) navigate(views[index].page, true);
  };
  return (
    <header className="model-infrastructure-header">
      <div className="model-infrastructure-heading">
        <h1>模型与智能体</h1>
        <p>统一管理模型服务与本机编程智能体</p>
      </div>
      <div
        className="model-infrastructure-tabs"
        role="tablist"
        aria-label="模型与智能体视图"
        onKeyDown={onKeyDown}
      >
        {views.map(({ page: view, label, icon: Icon }) => (
          <button
            key={view}
            ref={page === view ? selectedTab : undefined}
            type="button"
            id={`infrastructure-tab-${view}`}
            role="tab"
            aria-selected={page === view}
            aria-controls="model-infrastructure-content"
            tabIndex={page === view ? 0 : -1}
            onClick={() => {
              if (page !== view) navigate(view, false);
            }}
          >
            <Icon size={19} aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div className="model-infrastructure-actions">{actions}</div>
    </header>
  );
}
