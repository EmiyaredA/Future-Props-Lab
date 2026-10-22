import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  Files,
  LayoutTemplate,
  ListChecks,
  Save,
} from "lucide-react";
import { ThemeToggle } from "@shared/ui/ThemeToggle";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { useWorkspacePermission } from "@platform/auth/WorkspacePermissions";
import { fetchApiJson } from "@platform/api/client";
import {
  getVisualCanvas,
  selectNodeFinalOutput,
  type VisualCanvasNode,
  type VisualNodeOutput,
} from "../api";
import { visualWorkshopQueryKeys as keys } from "../queryKeys";
import {
  base,
  emptyDocument,
  getStandard,
  getTemplates,
  saveStandard,
  send,
  type Repair,
  type Run,
  type StandardDocument,
  type Template,
} from "./api";
import { TemplateLibrary } from "./TemplateLibrary";
import { StandardEditor } from "./StandardEditor";
import { RunsPane } from "./RunsPane";
import "./acceptance.css";
import "./standard-editor.css";
export function AcceptanceWorkspace({
  projectId,
  title,
  nodes,
  onBack,
  prepareCanvas,
  readOnly = false,
  initialOutput,
}: {
  projectId: string;
  title: string;
  nodes: VisualCanvasNode[];
  onBack: () => void;
  prepareCanvas?: () => Promise<number>;
  readOnly?: boolean;
  initialOutput?: VisualNodeOutput;
}) {
  const client = useQueryClient();
  const canWrite = useWorkspacePermission("content.write") && !readOnly;
  const [tab, setTab] = useState<"templates" | "standard" | "runs">(
    initialOutput ? "runs" : "templates",
  );
  const [draft, setDraft] = useState<StandardDocument>(emptyDocument);
  const [required, setRequired] = useState(false);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [repair, setRepair] = useState<Repair>(),
    [repairText, setRepairText] = useState("");
  const [confirm, setConfirm] = useState<{
    message: string;
    run: () => void;
  }>();
  const standard = useQuery({
    queryKey: keys.acceptanceStandard(projectId),
    queryFn: () => getStandard(projectId),
  });
  const templates = useQuery({
    queryKey: keys.acceptanceTemplates(),
    queryFn: getTemplates,
  });
  const loaded = useRef(-1);
  useEffect(() => {
    if (standard.data && loaded.current !== standard.data.revision && !dirty) {
      setDraft(structuredClone(standard.data.draft ?? emptyDocument()));
      setRequired(standard.data.required);
      loaded.current = standard.data.revision;
    }
  }, [standard.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  async function act<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请重试");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  const change = (value: StandardDocument) => {
    setDraft(value);
    setDirty(true);
  };
  const save = async (publish: boolean) => {
    if (!standard.data) return;
    const value = await act(() =>
      saveStandard(projectId, {
        expected_revision: standard.data!.revision,
        document: draft,
        publish,
        required,
      }),
    );
    if (value) {
      setDirty(false);
      loaded.current = value.revision;
      setDraft(structuredClone(value.draft ?? emptyDocument()));
      client.setQueryData(keys.acceptanceStandard(projectId), value);
      await client.invalidateQueries({ queryKey: keys.canvas(projectId) });
      if (publish) setTab("runs");
    }
  };
  const leave = () => {
    if (dirty)
      setConfirm({
        message: "标准有未保存的修改，返回后将丢弃这些修改。",
        run: onBack,
      });
    else onBack();
  };
  const useTemplate = (document: StandardDocument) => {
    const apply = () => {
      change({ ...document, title: `${document.title} · 项目版` });
      setTab("standard");
    };
    if (dirty)
      setConfirm({ message: "使用模板将替换尚未保存的标准草稿。", run: apply });
    else apply();
  };
  const deleteTemplate = async (template: Template) => {
    await act(async () => {
      await fetchApiJson(
        `/v1/visual-workshop/acceptance-templates/${template.id}?expected_revision=${template.revision}`,
        { method: "DELETE" },
      );
      await templates.refetch();
    });
  };
  const adopt = async (run: Run) => {
    if (prepareCanvas) await prepareCanvas();
    const revision = (await getVisualCanvas(projectId)).revision;
    const adopted = await selectNodeFinalOutput(
      projectId,
      run.node_id,
      run.output_id,
      revision,
    );
    client.setQueryData(keys.canvas(projectId), adopted);
    setNotice(`已将 v${run.snapshot.output.version} 设为最终输出`);
    await client.invalidateQueries({
      queryKey: keys.nodeOutputsProject(projectId),
    });
  };
  const saveRepair = async (apply: boolean) => {
    if (!repair) return;
    if (apply && prepareCanvas) await prepareCanvas();
    const revision = apply
      ? (await getVisualCanvas(projectId)).revision
      : undefined;
    const value = await act(() =>
      send<Repair>(
        `${base(projectId)}/repair-drafts/${repair.id}`,
        {
          expected_revision: repair.revision,
          text: repairText,
          apply,
          expected_canvas_revision: revision,
        },
        "PUT",
      ),
    );
    if (value) {
      setRepair(value);
      await client.invalidateQueries({ queryKey: keys.canvas(projectId) });
    }
  };
  return (
    <div className="acceptance-workspace">
      <header className="acceptance-header">
        <button onClick={leave} aria-label="返回创作工作台">
          <ArrowLeft size={18} />
        </button>
        <img src="/brand/visual-workshop-mark-cutout.png" alt="" />
        <div>
          <strong>{title}</strong>
          <small>视觉创作工坊 · 项目验收</small>
        </div>
        <ThemeToggle />
      </header>
      <nav className="acceptance-navigation" aria-label="项目验收">
        <strong>
          <ClipboardCheck size={19} /> 项目验收
        </strong>
        {(
          [
            ["templates", "模板库", LayoutTemplate],
            ["standard", "项目标准", ListChecks],
            ["runs", "验收记录", Files],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            className={tab === value ? "is-selected" : ""}
            onClick={() => setTab(value)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <main className="acceptance-body">
        {notice && (
          <p role="status" className="acceptance-notice">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="acceptance-error">
            {error}
          </p>
        )}
        {(standard.isError || templates.isError) && (
          <div role="alert">
            <p>验收数据加载失败。</p>
            <button
              onClick={() => {
                void standard.refetch();
                void templates.refetch();
              }}
            >
              重新加载
            </button>
          </div>
        )}
        {standard.isPending ? (
          <p role="status">正在加载项目标准…</p>
        ) : (
          <>
            {tab === "templates" && (
              <TemplateLibrary
                templates={templates.data?.items ?? []}
                writable={canWrite && !busy}
                onUse={useTemplate}
                onDelete={(template) => void deleteTemplate(template)}
              />
            )}
            <div hidden={tab !== "standard"}>
              {tab === "standard" && (
                <>
                  <div className="acceptance-section-heading">
                    <div>
                      <span className="acceptance-eyebrow">
                        项目标准 · STANDARD
                      </span>
                      <div className="acceptance-title-line">
                        <h2>配置项目验收标准</h2>
                        <span
                          className={`acceptance-badge ${dirty ? "pending" : "neutral"}`}
                        >
                          {dirty ? "未保存修改" : "已保存"}
                        </span>
                      </div>
                      <p className="acceptance-muted">
                        {standard.data?.published_version
                          ? `当前生效 v${standard.data.published_version}`
                          : "尚未发布"}{" "}
                        · 发布后形成独立版本，每次验收都可追溯。
                      </p>
                    </div>
                    <div className="acceptance-actions">
                      <button
                        disabled={!canWrite || busy}
                        onClick={() =>
                          void act(async () => {
                            await send(
                              "/v1/visual-workshop/acceptance-templates",
                              { expected_revision: 0, document: draft },
                            );
                            await templates.refetch();
                          })
                        }
                      >
                        保存为我的模板
                      </button>
                      <button
                        disabled={!canWrite || busy || !dirty}
                        onClick={() => void save(false)}
                      >
                        <Save size={15} /> 保存草稿
                      </button>
                      <button
                        className="acceptance-primary"
                        disabled={!canWrite || busy || !draft.criteria?.length}
                        onClick={() => void save(true)}
                      >
                        发布并选择验收版本{" "}
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <StandardEditor
                    document={draft}
                    nodes={nodes}
                    onChange={change}
                    required={required}
                    setRequired={(value) => {
                      setRequired(value);
                      setDirty(true);
                    }}
                    writable={canWrite && !busy}
                  />
                </>
              )}
            </div>
            {standard.data && (
              <div hidden={tab !== "runs"}>
                <RunsPane
                  projectId={projectId}
                  initialOutput={initialOutput}
                  nodes={nodes}
                  standard={standard.data}
                  writable={canWrite}
                  busy={busy}
                  act={act}
                  onRepair={(value) => {
                    setRepair(value);
                    setRepairText(value.text);
                  }}
                  onAdopt={adopt}
                />
              </div>
            )}
          </>
        )}
      </main>
      {confirm && (
        <ConfirmDialog
          open
          title="未保存的标准"
          description={confirm.message}
          confirmLabel="继续"
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => {
            confirm.run();
            setConfirm(undefined);
          }}
        />
      )}
      {repair && (
        <ConfirmDialog
          open
          title="验收返修草稿"
          className="acceptance-repair-dialog"
          tone="primary"
          pending={busy}
          confirmDisabled={!canWrite || !!repair.prompt_version_id}
          confirmLabel={
            repair.prompt_version_id
              ? "已保存为提示词版本"
              : "保存为新提示词版本"
          }
          onConfirm={() => saveRepair(true)}
          onCancel={() => setRepair(undefined)}
          description={
            <>
              <p>根据人工确认的问题整理。保存提示词后，由你手动提交生成。</p>
              <textarea
                aria-label="返修提示词"
                rows={12}
                maxLength={6000}
                value={repairText}
                onChange={(e) => setRepairText(e.target.value)}
                disabled={!canWrite || !!repair.prompt_version_id}
              />
              <button
                disabled={busy || !canWrite || !!repair.prompt_version_id}
                onClick={() => void saveRepair(false)}
              >
                保存草稿
              </button>
            </>
          }
        />
      )}
    </div>
  );
}
