import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ClipboardCheck,
  LayoutTemplate,
  MessageSquare,
  SlidersHorizontal,
} from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import type { VisualCanvasNode } from "../api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import { getAcceptanceCatalog, getAcceptanceSummary } from "./nodeApi";
import { ReadonlyTemplates } from "./ReadonlyTemplates";
import { ProjectAcceptanceSummary } from "./ProjectAcceptanceSummary";
import "./acceptance.css";
import "./model-picker.css";
import "./node-acceptance.css";

export function AcceptanceWorkspace({
  projectId,
  title,
  onBack,
  onOpenNode,
  readOnly = false,
  onView,
  onConversation,
  initialTab = "templates",
}: {
  projectId: string;
  title: string;
  nodes?: VisualCanvasNode[];
  readOnly?: boolean;
  initialTab?: "templates" | "summary";
  onView?: (view: "canvas" | "board") => void;
  onConversation?: () => void;
  onBack: () => void;
  onOpenNode?: (nodeId: string, outputId?: string) => void;
}) {
  const [tab, setTab] = useState<"templates" | "summary">(initialTab);
  const catalog = useQuery({
    queryKey: keys.acceptanceCatalog(),
    queryFn: getAcceptanceCatalog,
  });
  const summary = useQuery({
    queryKey: keys.acceptanceSummary(projectId),
    queryFn: () => getAcceptanceSummary(projectId),
    enabled: tab === "summary",
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "processing"].includes(item.state),
      )
        ? 1500
        : false,
  });
  return (
    <div className="acceptance-workspace project-acceptance">
      <header className="acceptance-header">
        <button onClick={onBack} aria-label="返回创作工作台">
          <ArrowLeft size={18} />
        </button>
        <img src="/brand/visual-workshop-mark-cutout.png" alt="" />
        <div>
          <strong>{title}</strong>
          <small>视觉创作工坊 · 项目验收{readOnly ? " · 只读" : ""}</small>
        </div>
        <div className="acceptance-header-actions">
          {onView && (
            <div
              className="visual-project-view-toggle"
              role="group"
              aria-label="项目视图"
            >
              <button onClick={() => onView("canvas")}>画布</button>
              <button className="active" onClick={() => onView("board")}>
                看板
              </button>
            </div>
          )}
          <button className="acceptance-project-control" aria-pressed="true">
            <SlidersHorizontal size={16} />
            项目验收
          </button>
          <ThemeToggle />
          {onConversation && (
            <button onClick={onConversation}>
              <MessageSquare size={16} />
              对话
            </button>
          )}
        </div>
      </header>
      <nav className="acceptance-navigation" aria-label="项目验收">
        <button
          aria-pressed={tab === "templates"}
          className={tab === "templates" ? "is-selected" : ""}
          onClick={() => setTab("templates")}
        >
          <LayoutTemplate size={17} /> 验收模板
        </button>
        <button
          aria-pressed={tab === "summary"}
          className={tab === "summary" ? "is-selected" : ""}
          onClick={() => setTab("summary")}
        >
          <ClipboardCheck size={17} /> 验收汇总
        </button>
      </nav>
      <main className="acceptance-body">
        {catalog.isError && (
          <p role="alert">
            模板读取失败。
            <button onClick={() => void catalog.refetch()}>重新加载</button>
          </p>
        )}
        {tab === "templates" ? (
          catalog.isPending ? (
            <p role="status">正在读取固定模板…</p>
          ) : (
            catalog.data && <ReadonlyTemplates catalog={catalog.data} />
          )
        ) : (
          <>
            {summary.isPending && <p role="status">正在读取验收汇总…</p>}
            {summary.isError && (
              <p role="alert">
                汇总读取失败。
                <button onClick={() => void summary.refetch()}>重新加载</button>
              </p>
            )}
            {summary.data && (
              <ProjectAcceptanceSummary
                summary={summary.data}
                catalog={catalog.data}
                onOpenNode={onOpenNode}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
