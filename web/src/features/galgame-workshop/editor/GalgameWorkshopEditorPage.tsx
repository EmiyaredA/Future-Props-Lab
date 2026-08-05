import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Flag,
  GitBranch,
  MapPinned,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Play,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { ApiError } from "@platform/api/client";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import {
  getGalgameStoryDocument,
  getGalgameStoryReport,
  getGalgameWorkshopProject,
  putGalgameStoryDocument,
  type GalgameStoryBlock,
  type GalgameStoryChapter,
  type GalgameStoryDocument,
  type GalgameStoryFragment,
  type GalgameStoryProject,
  type GalgameStoryRouteReport,
} from "@features/galgame-workshop/api";
import {
  completeStoryDocument,
  firstChapter,
  fragmentById,
  isTerminator,
  makeBlock,
  moveItem,
  referencedBy,
  stableId,
  type BlockKind,
  type EditorWorkspace,
  updateBlock,
  updateFirstChapter,
  updateFragment,
} from "@features/galgame-workshop/editor/model";
import {
  StoryPlayer,
  type StoryPlayerHandle,
} from "@features/galgame-workshop/editor/StoryPlayer";
import { CharacterWorkspace } from "@features/galgame-workshop/editor/CharacterWorkspace";
import { SceneWorkspace } from "@features/galgame-workshop/editor/SceneWorkspace";
import "@features/galgame-workshop/galgame-workshop.css";

const STORY_KEY = (projectId: string) =>
  ["galgame-workshop-story", projectId] as const;
const REPORT_KEY = (projectId: string) =>
  ["galgame-workshop-story-report", projectId] as const;
const PROJECT_KEY = (projectId: string) =>
  ["galgame-workshop-project", projectId] as const;

type SaveState = "saved" | "saving" | "error" | "conflict";
type InspectorTab = "properties" | "report";
type GalgameStoryReportIssue = GalgameStoryRouteReport["errors"][number];

const WORKSPACES: Array<{
  id: EditorWorkspace;
  label: string;
  icon: typeof BookOpenText;
}> = [
  { id: "script", label: "剧本", icon: BookOpenText },
  { id: "characters", label: "角色", icon: Users },
  { id: "scenes", label: "场景", icon: MapPinned },
  { id: "report", label: "检查", icon: CheckCircle2 },
];

const BLOCK_LABELS: Record<BlockKind, string> = {
  scene: "场景",
  narration: "旁白",
  dialogue: "对白",
  branch: "分支",
  endChapter: "章节结局",
};

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.problem.code === "revision_conflict")
    return "故事已在其他页面更新，请选择要保留的版本。";
  return error instanceof Error ? error.message : "保存失败，请稍后重试。";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="galgame-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function BlockTypeIcon({ type }: { type: BlockKind }) {
  if (type === "scene") return <MapPinned aria-hidden />;
  if (type === "dialogue") return <UserRound aria-hidden />;
  if (type === "branch") return <GitBranch aria-hidden />;
  if (type === "endChapter") return <Flag aria-hidden />;
  return <MessageSquareText aria-hidden />;
}

function blockSummary(
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
  chapter: GalgameStoryChapter,
) {
  if (block.type === "scene")
    return (
      document.scenes?.find((scene) => scene.id === block.sceneId)?.name ??
      "未知场景"
    );
  if (block.type === "narration") return block.text || "（空旁白）";
  if (block.type === "dialogue") return block.text || "（空对白）";
  if (block.type === "endChapter") return block.label;
  return block.choices
    .map((choice) => {
      const target = chapter.fragments?.find(
        (fragment) => fragment.id === choice.targetFragmentId,
      );
      return `${choice.text || "未命名选项"} → ${target?.title ?? "未知目标"}`;
    })
    .join(" · ");
}

function BlockCard({
  block,
  index,
  selected,
  document,
  chapter,
  onSelect,
}: {
  block: GalgameStoryBlock;
  index: number;
  selected: boolean;
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  onSelect: () => void;
}) {
  const character =
    block.type === "dialogue"
      ? document.characters?.find(
          (candidate) => candidate.id === block.characterId,
        )
      : undefined;
  return (
    <article
      className={`galgame-block-card is-${block.type} ${selected ? "selected" : ""}`}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <button
        type="button"
        className="galgame-block-select"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="galgame-block-kind">
          <BlockTypeIcon type={block.type} />
        </span>
        <span className="galgame-block-copy">
          <span>
            <strong>{BLOCK_LABELS[block.type]}</strong>
            {character ? <em>{character.name}</em> : null}
          </span>
          {block.type === "branch" ? (
            <>
              <b>{block.prompt || "请选择"}</b>
              <small>{blockSummary(block, document, chapter)}</small>
            </>
          ) : (
            <b>{blockSummary(block, document, chapter)}</b>
          )}
        </span>
        <MoreHorizontal aria-hidden />
      </button>
    </article>
  );
}

function BlockInspector({
  block,
  document,
  chapter,
  fragmentId,
  onDocument,
}: {
  block?: GalgameStoryBlock;
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  fragmentId: string;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  if (!block)
    return (
      <div className="galgame-inspector-empty">
        <Settings2 aria-hidden />
        <strong>未选择 Block</strong>
        <span>在中间的剧本流中选择一个 Block 后编辑属性。</span>
      </div>
    );

  const patch = (updater: (current: GalgameStoryBlock) => GalgameStoryBlock) =>
    onDocument(updateBlock(document, fragmentId, block.id, updater));

  return (
    <div className="galgame-block-inspector">
      <header>
        <span className={`galgame-block-kind is-${block.type}`}>
          <BlockTypeIcon type={block.type} />
        </span>
        <span>
          <strong>{BLOCK_LABELS[block.type]}</strong>
          <small>{block.id}</small>
        </span>
      </header>
      {block.type === "scene" ? (
        <>
          <Field label="切换场景">
            <select
              value={block.sceneId}
              onChange={(event) =>
                patch((current) =>
                  current.type === "scene"
                    ? {
                        ...current,
                        sceneId: event.target.value,
                        backgroundId: null,
                      }
                    : current,
                )
              }
            >
              {(document.scenes ?? []).map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="背景状态">
            <select
              value={block.backgroundId ?? ""}
              onChange={(event) =>
                patch((current) =>
                  current.type === "scene"
                    ? {
                        ...current,
                        backgroundId: event.target.value || null,
                      }
                    : current,
                )
              }
            >
              {(() => {
                const scene = (document.scenes ?? []).find(
                  (candidate) => candidate.id === block.sceneId,
                );
                const defaultBackground = (scene?.backgrounds ?? []).find(
                  (background) => background.id === scene?.defaultBackgroundId,
                );
                return (
                  <>
                    <option value="">
                      跟随场景默认
                      {defaultBackground
                        ? ` · ${defaultBackground.label}`
                        : " · 主题占位"}
                    </option>
                    {(scene?.backgrounds ?? []).map((background) => (
                      <option key={background.id} value={background.id}>
                        {background.label}
                      </option>
                    ))}
                  </>
                );
              })()}
            </select>
          </Field>
        </>
      ) : block.type === "narration" ? (
        <Field label="旁白正文">
          <textarea
            value={block.text}
            placeholder="写下旁白…"
            onChange={(event) =>
              patch((current) =>
                current.type === "narration"
                  ? { ...current, text: event.target.value }
                  : current,
              )
            }
          />
        </Field>
      ) : block.type === "dialogue" ? (
        <>
          <Field label="说话角色">
            <select
              value={block.characterId}
              onChange={(event) =>
                patch((current) =>
                  current.type === "dialogue"
                    ? {
                        ...current,
                        characterId: event.target.value,
                        expressionId: null,
                      }
                    : current,
                )
              }
            >
              {(document.characters ?? []).map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="对白表情">
            <select
              value={block.expressionId ?? ""}
              onChange={(event) =>
                patch((current) =>
                  current.type === "dialogue"
                    ? {
                        ...current,
                        expressionId: event.target.value || null,
                      }
                    : current,
                )
              }
            >
              {(() => {
                const character = (document.characters ?? []).find(
                  (candidate) => candidate.id === block.characterId,
                );
                const defaultExpression = (character?.expressions ?? []).find(
                  (expression) =>
                    expression.id === character?.defaultExpressionId,
                );
                return (
                  <>
                    <option value="">
                      跟随默认
                      {defaultExpression ? ` · ${defaultExpression.label}` : ""}
                    </option>
                    {(character?.expressions ?? []).map((expression) => (
                      <option key={expression.id} value={expression.id}>
                        {expression.label}
                      </option>
                    ))}
                  </>
                );
              })()}
            </select>
          </Field>
          <Field label="对白正文">
            <textarea
              value={block.text}
              placeholder="写下对白…"
              onChange={(event) =>
                patch((current) =>
                  current.type === "dialogue"
                    ? { ...current, text: event.target.value }
                    : current,
                )
              }
            />
          </Field>
        </>
      ) : block.type === "branch" ? (
        <>
          <Field label="选择提示">
            <input
              value={block.prompt}
              onChange={(event) =>
                patch((current) =>
                  current.type === "branch"
                    ? { ...current, prompt: event.target.value }
                    : current,
                )
              }
            />
          </Field>
          <div className="galgame-choice-editor">
            {block.choices.map((choice, choiceIndex) => (
              <div key={choice.id}>
                <Field label={`选项 ${choiceIndex + 1}`}>
                  <input
                    aria-label={`选项 ${choiceIndex + 1} 文案`}
                    value={choice.text}
                    onChange={(event) =>
                      patch((current) =>
                        current.type === "branch"
                          ? {
                              ...current,
                              choices: current.choices.map((item) =>
                                item.id === choice.id
                                  ? { ...item, text: event.target.value }
                                  : item,
                              ),
                            }
                          : current,
                      )
                    }
                  />
                </Field>
                <select
                  aria-label={`选项 ${choiceIndex + 1} 目标`}
                  value={choice.targetFragmentId}
                  onChange={(event) =>
                    patch((current) =>
                      current.type === "branch"
                        ? {
                            ...current,
                            choices: current.choices.map((item) =>
                              item.id === choice.id
                                ? {
                                    ...item,
                                    targetFragmentId: event.target.value,
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                >
                  {(chapter.fragments ?? [])
                    .filter((fragment) => fragment.id !== fragmentId)
                    .map((fragment) => (
                      <option key={fragment.id} value={fragment.id}>
                        {fragment.title}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Field label="结局名称">
          <input
            value={block.label}
            onChange={(event) =>
              patch((current) =>
                current.type === "endChapter"
                  ? { ...current, label: event.target.value }
                  : current,
              )
            }
          />
        </Field>
      )}
    </div>
  );
}

function storyRoutes(document: GalgameStoryProject) {
  return (document.chapters ?? []).flatMap((chapter) =>
    (chapter.fragments ?? []).flatMap((fragment) =>
      (fragment.blocks ?? []).flatMap((block) =>
        block.type === "branch"
          ? block.choices.map((choice) => ({
              sourceId: fragment.id,
              source: fragment.title,
              choice: choice.text,
              targetId: choice.targetFragmentId,
              target:
                chapter.fragments?.find(
                  (candidate) => candidate.id === choice.targetFragmentId,
                )?.title ?? choice.targetFragmentId,
            }))
          : [],
      ),
    ),
  );
}

function ReportInspector({
  report,
  document,
  onIssue,
}: {
  report?: GalgameStoryRouteReport;
  document: GalgameStoryProject;
  onIssue: (issue: GalgameStoryReportIssue) => void;
}) {
  const routes = useMemo(() => storyRoutes(document), [document]);
  if (!report)
    return <div className="galgame-inspector-loading">正在检查已保存线路…</div>;
  const chapter = report.chapters[0];
  return (
    <div className="galgame-inspector-report">
      <div className={report.ready ? "ready" : "blocked"}>
        {report.ready ? (
          <CheckCircle2 aria-hidden />
        ) : (
          <CircleAlert aria-hidden />
        )}
        <span>
          <strong>{report.ready ? "线路检查通过" : "线路尚未完成"}</strong>
          <small>
            {report.errors.length} 错误 · {report.warnings.length} 警告
          </small>
        </span>
      </div>
      <div className="galgame-inspector-metrics">
        <span>
          <strong>{chapter?.reachable_fragment_ids.length ?? 0}</strong>
          <small>可达 Fragment</small>
        </span>
        <span>
          <strong>{chapter?.ending_ids.length ?? 0}</strong>
          <small>结局</small>
        </span>
      </div>
      {routes.length ? (
        <div className="galgame-route-list">
          <strong>分支线路</strong>
          {routes.map((route) => (
            <div key={`${route.sourceId}-${route.targetId}-${route.choice}`}>
              <span>{route.source}</span>
              <em>→</em>
              <span>{route.target}</span>
              <small>{route.choice}</small>
            </div>
          ))}
        </div>
      ) : null}
      {[...report.errors, ...report.warnings].slice(0, 5).map((issue) => (
        <button
          key={`${issue.code}-${issue.path}`}
          type="button"
          className="galgame-inspector-issue"
          onClick={() => onIssue(issue)}
        >
          <CircleAlert aria-hidden />
          <span>
            <strong>{issue.message}</strong>
            <small>{issue.path}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export function GalgameWorkshopEditorPage({
  projectId,
  onOverview,
}: {
  projectId: string;
  onOverview: () => void;
}) {
  const client = useQueryClient();
  const revisionRef = useRef(0);
  const documentRef = useRef<GalgameStoryProject | undefined>(undefined);
  const saveQueue = useRef(Promise.resolve());
  const autoSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflictRef = useRef(false);
  const initialized = useRef(false);
  const playerRef = useRef<StoryPlayerHandle>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [workspace, setWorkspace] = useState<EditorWorkspace>("script");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [document, setDocument] = useState<GalgameStoryProject>();
  const [selectedFragmentId, setSelectedFragmentId] = useState("main");
  const [selectedBlockId, setSelectedBlockId] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<GalgameStoryDocument>();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const projectQuery = useQuery({
    queryKey: PROJECT_KEY(projectId),
    queryFn: () => getGalgameWorkshopProject(projectId),
  });
  const storyQuery = useQuery({
    queryKey: STORY_KEY(projectId),
    queryFn: () => getGalgameStoryDocument(projectId),
  });
  const reportQuery = useQuery({
    queryKey: REPORT_KEY(projectId),
    queryFn: () => getGalgameStoryReport(projectId),
  });

  useEffect(() => {
    if (!storyQuery.data || initialized.current) return;
    const next = completeStoryDocument(storyQuery.data.document);
    const entry = firstChapter(next)?.entryFragmentId ?? "main";
    const entryFragment = firstChapter(next)?.fragments?.find(
      (fragment) => fragment.id === entry,
    );
    initialized.current = true;
    revisionRef.current = storyQuery.data.revision;
    documentRef.current = next;
    setDocument(next);
    setSelectedFragmentId(entry);
    setSelectedBlockId(entryFragment?.blocks?.[0]?.id);
  }, [storyQuery.data]);

  useEffect(
    () => () => {
      if (autoSave.current) clearTimeout(autoSave.current);
    },
    [],
  );

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState === "saved") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  const enqueueSave = useCallback(
    (snapshot: GalgameStoryProject) => {
      const copy = structuredClone(snapshot);
      saveQueue.current = saveQueue.current.then(async () => {
        if (conflictRef.current) return;
        setSaveState("saving");
        setSaveMessage("");
        try {
          const updated = await putGalgameStoryDocument(
            projectId,
            copy,
            revisionRef.current,
          );
          revisionRef.current = updated.revision;
          client.setQueryData(STORY_KEY(projectId), updated);
          setSaveState("saved");
          void client.invalidateQueries({ queryKey: REPORT_KEY(projectId) });
          void client.invalidateQueries({ queryKey: PROJECT_KEY(projectId) });
          void client.invalidateQueries({
            queryKey: ["galgame-workshop-projects"],
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const current = error.problem.current as
              GalgameStoryDocument | undefined;
            if (current) {
              conflictRef.current = true;
              setConflict(current);
              setSaveState("conflict");
              return;
            }
          }
          setSaveState("error");
          setSaveMessage(errorMessage(error));
        }
      });
    },
    [client, projectId],
  );

  const replaceDocument = useCallback(
    (next: GalgameStoryProject) => {
      documentRef.current = next;
      setDocument(next);
      setSaveState("saving");
      if (autoSave.current) clearTimeout(autoSave.current);
      autoSave.current = setTimeout(
        () => enqueueSave(documentRef.current!),
        650,
      );
    },
    [enqueueSave],
  );

  if (storyQuery.isLoading || projectQuery.isLoading || !document)
    return (
      <div className="workshop-state galgame-editor-state">
        <RefreshCcw className="spinning" aria-hidden />
        <strong>正在打开剧本编辑器</strong>
      </div>
    );
  if (storyQuery.isError || projectQuery.isError)
    return (
      <div className="workshop-state galgame-editor-state">
        <strong>剧本编辑器暂时无法打开</strong>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );

  const chapter = firstChapter(document)!;
  const fragments = chapter.fragments ?? [];
  const selectedFragment =
    fragmentById(chapter, selectedFragmentId) ?? fragments[0];
  const selectedBlock = selectedFragment?.blocks?.find(
    (block) => block.id === selectedBlockId,
  );
  const report = reportQuery.data;
  const selectedIndex = selectedFragment?.blocks?.findIndex(
    (block) => block.id === selectedBlockId,
  );
  const lastBlock = selectedFragment?.blocks?.at(-1);
  const terminates = lastBlock ? isTerminator(lastBlock) : false;

  const selectFragment = (fragment: GalgameStoryFragment) => {
    setSelectedFragmentId(fragment.id);
    setSelectedBlockId(fragment.blocks?.[0]?.id);
  };
  const addFragment = () => {
    const id = stableId();
    replaceDocument(
      updateFirstChapter(document, (current) => ({
        ...current,
        fragments: [
          ...(current.fragments ?? []),
          {
            id,
            title: `Fragment ${(current.fragments?.length ?? 0) + 1}`,
            blocks: [],
          },
        ],
      })),
    );
    setSelectedFragmentId(id);
    setSelectedBlockId(undefined);
  };
  const deleteFragment = (fragment: GalgameStoryFragment) => {
    const references = referencedBy(document, "fragment", fragment.id);
    if (references.length) {
      setNotice(`无法删除：${references.join("、")}`);
      return;
    }
    if (fragments.length <= 1) {
      setNotice("章节至少需要保留一个 Fragment。");
      return;
    }
    const remaining = fragments.filter((item) => item.id !== fragment.id);
    replaceDocument(
      updateFirstChapter(document, (current) => ({
        ...current,
        fragments: remaining,
      })),
    );
    selectFragment(remaining[0]);
  };
  const addBlock = (kind: BlockKind) => {
    if (!selectedFragment) return;
    const block = makeBlock(kind, document, chapter, selectedFragment);
    if (!block) {
      setNotice(
        kind === "branch"
          ? "分支需要先准备至少两个其他 Fragment。"
          : kind === "dialogue"
            ? "请先创建角色。"
            : "请先创建场景。",
      );
      return;
    }
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) => ({
        ...fragment,
        blocks: [...(fragment.blocks ?? []), block],
      })),
    );
    setSelectedBlockId(block.id);
    setInspectorTab("properties");
  };
  const moveSelected = (direction: -1 | 1) => {
    if (!selectedFragment || selectedIndex === undefined || selectedIndex < 0)
      return;
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) => ({
        ...fragment,
        blocks: moveItem(fragment.blocks ?? [], selectedIndex, direction),
      })),
    );
  };
  const deleteSelected = () => {
    if (!selectedFragment || !selectedBlock) return;
    const blocks = selectedFragment.blocks ?? [];
    const index = blocks.findIndex((block) => block.id === selectedBlock.id);
    const remaining = blocks.filter((block) => block.id !== selectedBlock.id);
    replaceDocument(
      updateFragment(document, selectedFragment.id, (fragment) => ({
        ...fragment,
        blocks: remaining,
      })),
    );
    setSelectedBlockId(remaining[Math.min(index, remaining.length - 1)]?.id);
  };
  const locateIssue = (issue: GalgameStoryReportIssue) => {
    if (issue.fragment_id) {
      const fragment = fragmentById(chapter, issue.fragment_id);
      if (fragment) selectFragment(fragment);
    }
    if (issue.block_id) setSelectedBlockId(issue.block_id);
    setWorkspace("script");
    setInspectorTab("report");
  };
  const startPreview = () => {
    setWorkspace("script");
    requestAnimationFrame(() => {
      playerRef.current?.restart();
      previewRef.current?.focus();
    });
  };

  return (
    <section className="galgame-editor-page">
      <header className="galgame-editor-header">
        <div className="galgame-editor-project">
          <button
            type="button"
            className="galgame-editor-back"
            aria-label="返回工程概览"
            onClick={onOverview}
          >
            <ArrowLeft aria-hidden />
          </button>
          <img
            src="/brand/galgame-workshop-mark-cutout.png"
            alt=""
            aria-hidden
          />
          <span>
            <strong>{projectQuery.data?.title}</strong>
            <small>Galgame Workshop · Story V1</small>
          </span>
        </div>
        <div className="galgame-editor-actions">
          <div className={`galgame-save-state ${saveState}`} aria-live="polite">
            <Save aria-hidden />
            {saveState === "saved"
              ? "已保存"
              : saveState === "saving"
                ? "保存中"
                : saveState === "conflict"
                  ? "存在冲突"
                  : "保存失败"}
          </div>
          <button
            type="button"
            className="galgame-preview-launch"
            onClick={startPreview}
          >
            <Play aria-hidden /> 开始试玩
          </button>
        </div>
      </header>
      <nav className="galgame-editor-tabs" aria-label="创作工作区">
        {WORKSPACES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={workspace === item.id ? "active" : ""}
              onClick={() => setWorkspace(item.id)}
            >
              <Icon aria-hidden /> {item.label}
              {item.id === "report" && report ? (
                <em>{report.errors.length}</em>
              ) : null}
            </button>
          );
        })}
      </nav>

      {notice ? (
        <div className="galgame-inline-notice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")}>
            关闭
          </button>
        </div>
      ) : null}
      {saveMessage ? (
        <div className="galgame-inline-notice danger" role="alert">
          {saveMessage}
        </div>
      ) : null}

      {workspace === "script" ? (
        <div className="galgame-editor-grid">
          <aside className="galgame-fragment-panel">
            <div className="galgame-panel-heading">
              <span>
                <small>STORY</small>
                <strong>故事结构</strong>
              </span>
              <button
                type="button"
                aria-label="新建 Fragment"
                onClick={addFragment}
              >
                <Plus aria-hidden /> Fragment
              </button>
            </div>
            <details className="galgame-story-settings">
              <summary>
                <Settings2 aria-hidden /> 故事设置 <ChevronDown aria-hidden />
              </summary>
              <Field label="故事简介">
                <textarea
                  value={document.synopsis}
                  placeholder="用几句话说明故事核心…"
                  onChange={(event) =>
                    replaceDocument({
                      ...document,
                      synopsis: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="章节名称">
                <input
                  value={chapter.title}
                  onChange={(event) =>
                    replaceDocument(
                      updateFirstChapter(document, (current) => ({
                        ...current,
                        title: event.target.value,
                      })),
                    )
                  }
                />
              </Field>
            </details>
            <div className="galgame-chapter-row">
              <span>
                <ChevronDown aria-hidden />
                <strong>{chapter.title}</strong>
              </span>
              <em>{fragments.length}</em>
            </div>
            <div className="galgame-fragment-list">
              {fragments.map((fragment) => (
                <button
                  key={fragment.id}
                  type="button"
                  className={
                    selectedFragment?.id === fragment.id ? "active" : ""
                  }
                  onClick={() => selectFragment(fragment)}
                >
                  <span>
                    <GitBranch aria-hidden />
                    <strong>{fragment.title}</strong>
                  </span>
                  <span>
                    {chapter.entryFragmentId === fragment.id ? (
                      <em>入口</em>
                    ) : null}
                    <small>{fragment.blocks?.length ?? 0}</small>
                  </span>
                </button>
              ))}
            </div>
            {selectedFragment ? (
              <div className="galgame-fragment-actions">
                <button
                  type="button"
                  disabled={chapter.entryFragmentId === selectedFragment.id}
                  onClick={() =>
                    replaceDocument(
                      updateFirstChapter(document, (current) => ({
                        ...current,
                        entryFragmentId: selectedFragment.id,
                      })),
                    )
                  }
                >
                  设为入口
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => deleteFragment(selectedFragment)}
                >
                  删除
                </button>
              </div>
            ) : null}
            <footer>
              <span /> {fragments.length} 个 Fragment · 自动保存已开启
            </footer>
          </aside>

          <main className="galgame-block-panel">
            {selectedFragment ? (
              <>
                <header className="galgame-block-toolbar">
                  <div>
                    <Field label="Fragment 名称">
                      <input
                        value={selectedFragment.title}
                        onChange={(event) =>
                          replaceDocument(
                            updateFragment(
                              document,
                              selectedFragment.id,
                              (fragment) => ({
                                ...fragment,
                                title: event.target.value,
                              }),
                            ),
                          )
                        }
                      />
                    </Field>
                    <small>{selectedFragment.blocks?.length ?? 0} Block</small>
                  </div>
                  <div className="galgame-selected-actions">
                    <button
                      type="button"
                      aria-label="上移 Block"
                      disabled={!selectedBlock || selectedIndex === 0}
                      onClick={() => moveSelected(-1)}
                    >
                      <ArrowUp aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="下移 Block"
                      disabled={
                        !selectedBlock ||
                        selectedIndex ===
                          (selectedFragment.blocks?.length ?? 0) - 1
                      }
                      onClick={() => moveSelected(1)}
                    >
                      <ArrowDown aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="删除 Block"
                      disabled={!selectedBlock}
                      onClick={deleteSelected}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </header>
                <div className="galgame-block-list">
                  {(selectedFragment.blocks ?? []).map((block, index) => (
                    <BlockCard
                      key={block.id}
                      block={block}
                      index={index}
                      selected={block.id === selectedBlockId}
                      document={document}
                      chapter={chapter}
                      onSelect={() => {
                        setSelectedBlockId(block.id);
                        setInspectorTab("properties");
                      }}
                    />
                  ))}
                  {!selectedFragment.blocks?.length ? (
                    <div className="galgame-empty-blocks">
                      <MessageSquareText aria-hidden />
                      <strong>这个 Fragment 还没有 Block</strong>
                      <span>从下方添加场景、对白、分支或章节结局。</span>
                    </div>
                  ) : null}
                </div>
                <div className="galgame-block-add">
                  {(
                    [
                      "scene",
                      "narration",
                      "dialogue",
                      "branch",
                      "endChapter",
                    ] as BlockKind[]
                  ).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={terminates}
                      onClick={() => addBlock(kind)}
                    >
                      <Plus aria-hidden /> {BLOCK_LABELS[kind]}
                    </button>
                  ))}
                </div>
                {terminates ? (
                  <small className="galgame-terminator-note">
                    当前 Fragment 已有终止 Block；删除或移动它后才能继续添加。
                  </small>
                ) : null}
              </>
            ) : null}
          </main>

          <aside className="galgame-preview-panel">
            <div
              ref={previewRef}
              tabIndex={-1}
              className="galgame-preview-focus"
            >
              <StoryPlayer ref={playerRef} document={document} />
            </div>
            <nav className="galgame-inspector-tabs" aria-label="Block 检查器">
              <button
                type="button"
                className={inspectorTab === "properties" ? "active" : ""}
                onClick={() => setInspectorTab("properties")}
              >
                属性
              </button>
              <button
                type="button"
                className={inspectorTab === "report" ? "active" : ""}
                onClick={() => setInspectorTab("report")}
              >
                检查
                {report ? <em>{report.errors.length}</em> : null}
              </button>
            </nav>
            <div className="galgame-inspector-body">
              {inspectorTab === "properties" ? (
                <BlockInspector
                  block={selectedBlock}
                  document={document}
                  chapter={chapter}
                  fragmentId={selectedFragment?.id ?? ""}
                  onDocument={replaceDocument}
                />
              ) : (
                <ReportInspector
                  report={report}
                  document={document}
                  onIssue={locateIssue}
                />
              )}
            </div>
          </aside>
        </div>
      ) : workspace === "characters" ? (
        <CharacterWorkspace
          projectId={projectId}
          document={document}
          onDocument={replaceDocument}
          onNotice={setNotice}
          onLocate={(fragmentId, blockId) => {
            const fragment = fragmentById(chapter, fragmentId);
            if (fragment) selectFragment(fragment);
            setSelectedBlockId(blockId);
            setWorkspace("script");
            setInspectorTab("properties");
          }}
        />
      ) : workspace === "scenes" ? (
        <SceneWorkspace
          projectId={projectId}
          document={document}
          onDocument={replaceDocument}
          onNotice={setNotice}
          onLocate={(fragmentId, blockId) => {
            const fragment = fragmentById(chapter, fragmentId);
            if (fragment) selectFragment(fragment);
            setSelectedBlockId(blockId);
            setWorkspace("script");
            setInspectorTab("properties");
          }}
        />
      ) : (
        <FullReport
          report={report}
          onIssue={locateIssue}
          onRefresh={() => void reportQuery.refetch()}
        />
      )}

      {conflict ? (
        <div className="galgame-conflict" role="alert">
          <span>
            <strong>故事存在更新冲突</strong>
            本地草稿仍保留，请选择要使用的版本。
          </span>
          <button
            type="button"
            onClick={() => {
              const next = completeStoryDocument(conflict.document);
              const nextChapter = firstChapter(next);
              const nextFragment = nextChapter?.fragments?.find(
                (fragment) => fragment.id === nextChapter.entryFragmentId,
              );
              revisionRef.current = conflict.revision;
              documentRef.current = next;
              conflictRef.current = false;
              client.setQueryData(STORY_KEY(projectId), conflict);
              setDocument(next);
              setSelectedFragmentId(
                nextFragment?.id ?? nextChapter?.fragments?.[0]?.id ?? "main",
              );
              setSelectedBlockId(nextFragment?.blocks?.[0]?.id);
              setConflict(undefined);
              setSaveState("saved");
            }}
          >
            载入服务器版本
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => setConfirmOverwrite(true)}
          >
            用本地版本覆盖
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmOverwrite && Boolean(conflict)}
        title="用本地草稿覆盖服务器版本？"
        description="这会以服务器最新 revision 为基准保存当前本地草稿，服务器上的故事内容将被替换。"
        confirmLabel="确认覆盖"
        onCancel={() => setConfirmOverwrite(false)}
        onConfirm={() => {
          if (!conflict) return;
          revisionRef.current = conflict.revision;
          conflictRef.current = false;
          setConflict(undefined);
          setConfirmOverwrite(false);
          enqueueSave(documentRef.current!);
        }}
      />
    </section>
  );
}

function FullReport({
  report,
  onIssue,
  onRefresh,
}: {
  report?: GalgameStoryRouteReport;
  onIssue: (issue: GalgameStoryReportIssue) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="galgame-full-report">
      <header>
        <div>
          <small>ROUTE REPORT</small>
          <strong>工程检查</strong>
          <span>基于已保存故事执行确定性线路分析。</span>
        </div>
        <button type="button" onClick={onRefresh}>
          <RefreshCcw aria-hidden /> 重新检查
        </button>
      </header>
      {report ? (
        <>
          <div className="galgame-report-metrics">
            <article>
              <strong>{report.errors.length}</strong>
              <span>错误</span>
            </article>
            <article>
              <strong>{report.warnings.length}</strong>
              <span>警告</span>
            </article>
            <article>
              <strong>
                {report.chapters[0]?.reachable_fragment_ids.length ?? 0}
              </strong>
              <span>可达 Fragment</span>
            </article>
            <article>
              <strong>{report.chapters[0]?.ending_ids.length ?? 0}</strong>
              <span>结局</span>
            </article>
          </div>
          <div className="galgame-issue-list">
            {[...report.errors, ...report.warnings].map((issue) => (
              <button
                key={`${issue.code}-${issue.path}`}
                type="button"
                className={report.errors.includes(issue) ? "error" : "warning"}
                onClick={() => onIssue(issue)}
              >
                <CircleAlert aria-hidden />
                <span>
                  <strong>{issue.message}</strong>
                  <small>{issue.path}</small>
                </span>
              </button>
            ))}
            {!report.errors.length && !report.warnings.length ? (
              <div className="galgame-report-clear">
                <CheckCircle2 aria-hidden />
                <strong>结构和线路检查已通过</strong>
                <span>当前章节所有 Fragment 均可达，并存在明确结局。</span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
