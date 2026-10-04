import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  Check,
  CirclePlay,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import { api, ApiError, unwrap } from "@platform/api/client";
import {
  getDocument,
  getProject,
  replacePackage,
  saveDocument,
  syncSource,
  uploadSkin,
  type PetConfig,
  type PetDocument,
  type PetHabits,
  type PetProject,
  type PetReaction,
} from "./api";
import { EditorStage } from "./EditorStage";
import { CompactPanelTabs } from "@shared/ui/CompactPanelTabs";
import { SkinUpload } from "./SkinUpload";
import "./editor-layout.css";
import "./editor-controls.css";
import { PackageUpdate } from "./PackageUpdate";
import { useEditorPreview } from "./useEditorPreview";
import { useDesktopPreviewLink } from "./useDesktopPreviewLink";
import { reactionFor } from "./playback";
import { humanMotionUnavailable } from "./locomotion/motionAvailability";
import { DialogueInspector } from "./DialogueInspector";
import "./workshop.css";

type Tab = "look" | "events" | "lines" | "chat" | "habits" | "preview";
type EventName = "idle" | "click" | "pet" | "grab" | "drop" | "roam";
const EVENTS: { id: EventName; label: string; detail: string }[] = [
  { id: "idle", label: "待机", detail: "循环" },
  { id: "click", label: "点击身体", detail: "点击" },
  { id: "pet", label: "摸头", detail: "头部热区" },
  { id: "grab", label: "拖起", detail: "开始拖动" },
  { id: "drop", label: "放下", detail: "结束拖动" },
  { id: "roam", label: "自主走动", detail: "空闲" },
];
const ACTIONS: {
  id: "dress" | "roam" | "hide" | "settings" | "chat";
  label: string;
}[] = [
  { id: "dress", label: "装扮" },
  { id: "roam", label: "走动" },
  { id: "hide", label: "隐藏" },
  { id: "settings", label: "设置" },
  { id: "chat", label: "聊天" },
];
const EMPTY_REACTION: PetReaction = {
  motionId: null,
  expressionId: null,
  lines: [],
  sound: "none",
};
const DEFAULT_HABITS: PetHabits = {
  roam: "calm",
  size: 220,
  draggable: true,
  bubbles: true,
  sound: true,
  edgeClimbing: true,
  highGliding: true,
  hoverActions: ["dress", "roam", "hide", "chat"],
};

function normalize(config: PetConfig): PetConfig {
  return {
    schemaVersion: 2,
    skins: config.skins ?? [],
    activeSkinId: config.activeSkinId ?? null,
    schemeId: config.schemeId ?? null,
    events: config.events ?? {},
    habits: { ...DEFAULT_HABITS, ...config.habits },
    persona: config.persona ?? {
      description: "",
      personality: "",
      speakingStyle: "",
      greeting: "",
    },
  };
}

export function EditorPage({
  projectId,
  onBack,
  readOnly = false,
  registerNavigationGuard,
}: {
  projectId: string;
  onBack: () => void;
  readOnly?: boolean;
  registerNavigationGuard?: (
    guard: ((proceed: () => void) => boolean) | null,
  ) => void;
}) {
  const [project, setProject] = useState<PetProject | null>(null);
  const [snapshot, setSnapshot] = useState<PetDocument | null>(null);
  const [config, setConfig] = useState<PetConfig | null>(null);
  const [tab, setTab] = useState<Tab>("look");
  const [panel, setPanel] = useState("preview");
  const [skinId, setSkinId] = useState<string | null>(null);
  const [eventName, setEventName] = useState<EventName>("click");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [active, setActive] = useState(false);
  const [newSkinName, setNewSkinName] = useState("");
  const [leaving, setLeaving] = useState<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([getProject(projectId), getDocument(projectId)])
      .then(([projectValue, documentValue]) => {
        if (!mounted) return;
        setProject(projectValue);
        setSnapshot(documentValue);
        setConfig(normalize(documentValue.config));
        setSkinId(
          documentValue.sourceType === "coopanion-whale"
            ? (documentValue.config.schemeId ?? "deepseek")
            : (documentValue.config.activeSkinId ?? null),
        );
      })
      .catch((cause) => {
        if (mounted) setError(String(cause));
      });
    void window.futurePropsDesktop?.petStatus?.().then((status) => {
      if (mounted) setActive(status.projectId === projectId);
    });
    return () => {
      mounted = false;
    };
  }, [projectId]);
  useEffect(() => {
    registerNavigationGuard?.((proceed) => {
      if (!dirty) return false;
      setLeaving(() => proceed);
      return true;
    });
    return () => registerNavigationGuard?.(null);
  }, [dirty, registerNavigationGuard]);

  const draft = useMemo(
    () => (snapshot && config ? { ...snapshot, config } : null),
    [snapshot, config],
  );
  const whale = snapshot?.sourceType === "coopanion-whale";
  const figureName = project?.title || "桌宠角色";
  const schemes =
    (snapshot?.whaleModel?.schemes as
      { id: string; brand: string; label: string }[] | undefined) ?? [];
  const defaultScheme = schemes.find((item) => item.id === config?.schemeId);
  const skins = config?.skins ?? [];
  const selectedSkin = skins.find((item) => item.id === skinId);
  const reaction = draft ? reactionFor(draft, eventName) : EMPTY_REACTION;
  const preview = useEditorPreview(draft, tab, eventName);
  const link = useDesktopPreviewLink(projectId, draft, skinId, preview);
  const habits = config?.habits ?? DEFAULT_HABITS;
  const assets = useMemo(() => {
    if (!snapshot) return [];
    const names = new Map<string, string>();
    for (const part of snapshot.character?.parts ?? [])
      if (!names.has(part.assetId)) names.set(part.assetId, part.name);
    return [...names].map(([id, name]) => ({ id, name }));
  }, [snapshot]);

  const edit = (update: (value: PetConfig) => PetConfig) => {
    if (readOnly || busy) return;
    setConfig((value) => value && update(value));
    setDirty(true);
    setConflict(false);
  };
  const editReaction = (patch: Partial<PetReaction>) =>
    edit((value) => ({
      ...value,
      events: {
        ...value.events,
        [eventName]: {
          ...(snapshot
            ? reactionFor({ ...snapshot, config: value }, eventName)
            : EMPTY_REACTION),
          ...patch,
        },
      },
    }));
  const editHabits = (patch: Partial<PetHabits>) =>
    edit((value) => ({
      ...value,
      habits: { ...DEFAULT_HABITS, ...value.habits, ...patch },
    }));
  const save = async (): Promise<PetDocument> => {
    if (!snapshot || !config) throw new Error("桌宠项目尚未加载");
    if (!dirty) return snapshot;
    const saved = await saveDocument(projectId, snapshot.revision, config);
    setSnapshot(saved);
    setConfig(normalize(saved.config));
    setProject(
      (current) => current && { ...current, revision: saved.revision },
    );
    setDirty(false);
    try {
      await window.futurePropsDesktop?.notifyPetResourcesChanged?.(projectId);
    } catch {
      setError("配置已保存，桌宠刷新失败；请重新显示桌宠。不要重复保存。");
    }
    return saved;
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setConflict(cause instanceof ApiError && cause.status === 409);
      setError(cause instanceof Error ? cause.message : "桌宠操作失败");
    } finally {
      setBusy(false);
    }
  };
  const reload = () =>
    run(async () => {
      const [projectValue, documentValue] = await Promise.all([
        getProject(projectId),
        getDocument(projectId),
      ]);
      setProject(projectValue);
      setSnapshot(documentValue);
      setConfig(normalize(documentValue.config));
      setSkinId(
        documentValue.sourceType === "coopanion-whale"
          ? (documentValue.config.schemeId ?? "deepseek")
          : (documentValue.config.activeSkinId ?? null),
      );
      setDirty(false);
      setConflict(false);
    });
  const leave = () => {
    if (dirty) setLeaving(() => onBack);
    else onBack();
  };
  const launch = () =>
    run(async () => {
      if (!window.futurePropsDesktop?.openPet)
        throw new Error("真实桌宠仅在 macOS 桌面版中运行");
      await save();
      await window.futurePropsDesktop.openPet(projectId);
      setActive(true);
    });
  const launchChat = () =>
    run(async () => {
      if (
        !window.futurePropsDesktop?.openPet ||
        !window.futurePropsDesktop.openPetChatFromStudio
      )
        throw new Error("聊天小窗仅在 macOS 桌面版中运行");
      await save();
      await window.futurePropsDesktop.openPet(projectId);
      setActive(true);
      await window.futurePropsDesktop.openPetChatFromStudio(projectId);
    });
  const addSkin = () => {
    const name = newSkinName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    edit((value) => ({
      ...value,
      skins: [...(value.skins ?? []), { id, name, replacements: {} }],
      activeSkinId: id,
    }));
    setSkinId(id);
    setNewSkinName("");
  };
  const upload = (assetId: string, file: File) =>
    run(async () => {
      if (!skinId) throw new Error("先选择一个皮肤");
      const saved = await save();
      const updated = await uploadSkin(
        projectId,
        skinId,
        assetId,
        saved.revision,
        file,
      );
      setSnapshot(updated);
      setConfig(normalize(updated.config));
      setProject(
        (current) => current && { ...current, revision: updated.revision },
      );
    });
  const updateSource = () =>
    run(async () => {
      if (!project || !snapshot || !project.sourceProjectId) return;
      const source = unwrap(
        await api.GET("/v1/live2d-workshop/projects/{project_id}", {
          params: { path: { project_id: project.sourceProjectId } },
        }),
      );
      const sourceProject = await source;
      const saved = await save();
      const updated = await syncSource(
        projectId,
        saved.revision,
        sourceProject.revision,
      );
      setSnapshot(updated);
      setConfig(normalize(updated.config));
      setProject(
        (current) =>
          current && {
            ...current,
            revision: updated.revision,
            sourceRevision: updated.sourceRevision,
            sourceTitle: sourceProject.title,
          },
      );
    });
  const updatePackage = (file: File) =>
    run(async () => {
      if (!snapshot || dirty || link.enabled) return;
      const updated = await replacePackage(projectId, snapshot.revision, file);
      setSnapshot(updated);
      setConfig(normalize(updated.config));
      setSkinId(updated.config.schemeId ?? null);
      setProject(
        (current) => current && { ...current, revision: updated.revision },
      );
      setConflict(false);
      try {
        await window.futurePropsDesktop?.notifyPetResourcesChanged?.(projectId);
      } catch {
        setError("资源包已更新，桌面刷新失败；请重新显示桌宠。不要重复上传。");
      }
    });

  return (
    <section className="dp-editor" data-panel={panel}>
      <header className="dp-editor-header">
        <button className="dp-back" onClick={leave} aria-label="返回桌宠项目">
          <ArrowLeft size={18} />
        </button>
        <div className="dp-editor-title">
          <strong title={project?.title}>{project?.title ?? "桌宠项目"}</strong>
          <small>
            {!snapshot ? "尚未加载" : dirty ? "未保存修改" : "已保存"} ·{" "}
            {!snapshot
              ? "来源尚未加载"
              : whale
                ? "分层角色快照"
                : `来源 r${project?.sourceRevision ?? "—"}`}
          </small>
        </div>
        <nav aria-label="桌宠编辑步骤">
          {(
            [
              ["look", "形象"],
              ["events", "交互"],
              ["lines", "台词"],
              ["chat", "聊天"],
              ["habits", "习惯"],
              ["preview", "试玩"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          disabled={busy || !dirty || readOnly}
          onClick={() =>
            void run(async () => {
              await save();
            })
          }
        >
          <Save size={15} />
          保存
        </button>
        <button
          className="dp-primary"
          disabled={busy}
          onClick={() => void launch()}
        >
          <CirclePlay size={15} />
          {active ? "显示桌宠" : "放到桌面"}
        </button>
      </header>
      {readOnly && (
        <p className="dp-readonly" role="status">
          只读浏览 · 可调整预览，项目配置不可修改
        </p>
      )}
      {error && (
        <div className="dp-editor-alert" role="alert">
          {error}
          {conflict && (
            <button onClick={() => void reload()}>载入最新版本</button>
          )}
        </div>
      )}
      {!draft || !config ? (
        <div className="dp-loading" role="status">
          <span>{error ? "桌宠工程加载失败" : "正在加载桌宠工程…"}</span>
          {error && (
            <button
              className="dp-side-action"
              disabled={busy}
              onClick={() => void reload()}
            >
              重新加载
            </button>
          )}
        </div>
      ) : (
        <>
          <CompactPanelTabs
            label="桌宠工作区面板"
            value={panel}
            onChange={setPanel}
            options={[
              { value: "list", label: "列表" },
              { value: "preview", label: "预览" },
              { value: "properties", label: "属性" },
            ]}
          />
          <div className="dp-editor-body">
            <aside className="dp-editor-left">
              {tab === "look" && (
                <>
                  <div className="dp-panel-heading">
                    <strong>形象与皮肤</strong>
                    <small>{whale ? schemes.length : skins.length} 套</small>
                  </div>
                  <div className="dp-source-card">
                    <strong>{whale ? figureName : project?.sourceTitle}</strong>
                    <small>
                      {whale
                        ? "分层角色 · 本地导入快照"
                        : `Live2D 工坊 · 固定版本 r${project?.sourceRevision}`}
                    </small>
                  </div>
                  {whale && !readOnly && (
                    <PackageUpdate
                      disabled={busy || dirty || link.enabled}
                      reason={
                        dirty
                          ? "请先保存当前修改"
                          : link.enabled
                            ? "请先结束桌面联动"
                            : undefined
                      }
                      onUpdate={(file) => void updatePackage(file)}
                    />
                  )}
                  <p className="dp-section-label">
                    {whale ? "原版配色" : "皮肤列表"}
                  </p>
                  {whale ? (
                    schemes.map((item) => (
                      <button
                        key={item.id}
                        className="dp-side-item"
                        aria-pressed={skinId === item.id}
                        onClick={() => setSkinId(item.id)}
                      >
                        {item.brand} · {item.label}
                      </button>
                    ))
                  ) : (
                    <>
                      <button
                        className="dp-side-item"
                        aria-pressed={!skinId}
                        onClick={() => setSkinId(null)}
                      >
                        默认形象
                      </button>
                      {skins.map((item) => (
                        <button
                          key={item.id}
                          className="dp-side-item"
                          aria-pressed={skinId === item.id}
                          onClick={() => setSkinId(item.id)}
                        >
                          {item.name}
                        </button>
                      ))}
                      {!readOnly && (
                        <div className="dp-add-skin">
                          <input
                            aria-label="新皮肤名称"
                            maxLength={60}
                            placeholder="新皮肤名称"
                            value={newSkinName}
                            onChange={(event) =>
                              setNewSkinName(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") addSkin();
                            }}
                          />
                          <button
                            onClick={addSkin}
                            disabled={busy || !newSkinName.trim()}
                            aria-label="添加皮肤"
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      )}
                      <div className="dp-hint">
                        皮肤替换部件贴图，继续使用来源角色的网格与动作。
                      </div>
                    </>
                  )}
                  {whale && (
                    <div className="dp-hint">
                      {schemes.length}{" "}
                      套配色共用角色分件动画；选中后可设为桌宠默认外观。
                    </div>
                  )}
                </>
              )}
              {(tab === "events" || tab === "lines") && (
                <>
                  <div className="dp-panel-heading">
                    <strong>{tab === "lines" ? "事件台词" : "触发事件"}</strong>
                    <small>6 种</small>
                  </div>
                  {EVENTS.map((item) => (
                    <button
                      key={item.id}
                      className="dp-side-item"
                      aria-pressed={eventName === item.id}
                      onClick={() => {
                        if (eventName === item.id) preview.inspect(item.id);
                        setEventName(item.id);
                      }}
                    >
                      {item.label}
                      <small>{item.detail}</small>
                    </button>
                  ))}
                  <div className="dp-hint">
                    点击头部热区触发「摸头」，身体其他区域触发「点击」；拖拽产生「拖起」「放下」。
                  </div>
                </>
              )}
              {tab === "chat" && (
                <>
                  <div className="dp-panel-heading">
                    <strong>角色聊天</strong>
                  </div>
                  <p className="dp-hint">
                    填写人设后，模型会按这些设定回复。聊天模型和私人记录由使用者在桌面小窗中单独选择与保存。
                  </p>
                </>
              )}
              {tab === "habits" && (
                <>
                  <div className="dp-panel-heading">
                    <strong>行为习惯</strong>
                  </div>
                  <p className="dp-hint">
                    桌宠会限制在屏幕可用区域内。右侧的值是下次放到桌面的默认配置。
                  </p>
                  <p className="dp-section-label">悬停按钮</p>
                  <div className="dp-hint">
                    最多选择四个；聊天按钮会打开桌宠旁的小窗。运行时改动只影响当前会话。
                  </div>
                </>
              )}
              {tab === "preview" && (
                <>
                  <div className="dp-panel-heading">
                    <strong>试玩与来源</strong>
                  </div>
                  <div className="dp-source-card">
                    <strong>
                      {whale
                        ? "分层角色本地快照"
                        : `来源角色 r${project?.sourceRevision}`}
                    </strong>
                    <small>{whale ? figureName : project?.sourceTitle}</small>
                  </div>
                  {!whale && (
                    <button
                      className="dp-side-action"
                      disabled={busy || readOnly}
                      onClick={() => void updateSource()}
                    >
                      <RefreshCw size={15} />
                      检查并更新来源
                    </button>
                  )}
                  <div className="dp-hint">
                    {whale
                      ? "资源已保存为当前 Workspace 的固定快照，不再依赖原始目录。"
                      : "更新来源前会检查动作、表情和换肤贴图的兼容性；不兼容时保留当前快照。"}
                  </div>
                </>
              )}
            </aside>
            <EditorStage
              document={draft}
              tab={tab}
              skinId={skinId}
              figureName={figureName}
              preview={preview}
              link={link}
            />
            <aside className="dp-editor-right">
              {tab === "look" && (
                <>
                  {whale ? (
                    <>
                      <div className="dp-panel-heading">
                        <strong>
                          {schemes.find((item) => item.id === skinId)?.brand ??
                            figureName}
                        </strong>
                        <small>{schemes.length} 套配色</small>
                      </div>
                      <p className="dp-hint">
                        使用资源包中的贴图、表情与分件动画。配色仅影响当前预览，保存默认值后下次启动生效。
                      </p>
                      <button
                        className="dp-side-action"
                        disabled={
                          busy ||
                          readOnly ||
                          !skinId ||
                          config.schemeId === skinId
                        }
                        onClick={() =>
                          edit((value) => ({ ...value, schemeId: skinId }))
                        }
                      >
                        <Check size={15} />
                        设为桌宠默认配色
                      </button>
                      <p className="dp-hint">
                        当前默认：
                        {defaultScheme
                          ? `${defaultScheme.brand} · ${defaultScheme.label}`
                          : "尚未设置"}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="dp-panel-heading">
                        <strong>{selectedSkin?.name ?? "默认形象"}</strong>
                        <small>装扮属性</small>
                      </div>
                      {selectedSkin ? (
                        <>
                          <label className="dp-field">
                            <span>皮肤名称</span>
                            <input
                              disabled={busy || readOnly}
                              maxLength={60}
                              value={selectedSkin.name}
                              onChange={(event) =>
                                edit((value) => ({
                                  ...value,
                                  skins: value.skins?.map((skin) =>
                                    skin.id === selectedSkin.id
                                      ? { ...skin, name: event.target.value }
                                      : skin,
                                  ),
                                }))
                              }
                            />
                          </label>
                          <p className="dp-section-label">替换部件贴图</p>
                          <div className="dp-asset-list">
                            {assets.map((item) => (
                              <div key={item.id} className="dp-asset-row">
                                <span>
                                  {item.name}
                                  <small>
                                    {selectedSkin.replacements?.[item.id]
                                      ? "已替换"
                                      : "使用默认"}
                                  </small>
                                </span>
                                <SkinUpload
                                  name={item.name}
                                  disabled={busy || readOnly}
                                  onUpload={(file) =>
                                    void upload(item.id, file)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                          <button
                            className="dp-side-action"
                            disabled={busy || readOnly}
                            onClick={() => {
                              edit((value) => ({
                                ...value,
                                skins: value.skins?.filter(
                                  (item) => item.id !== skinId,
                                ),
                                activeSkinId:
                                  value.activeSkinId === skinId
                                    ? null
                                    : value.activeSkinId,
                              }));
                              setSkinId(null);
                            }}
                          >
                            删除这套皮肤
                          </button>
                        </>
                      ) : (
                        <div className="dp-hint">
                          默认形象使用来源角色的原始贴图。新增皮肤后，可逐个替换需要换装的部件。
                        </div>
                      )}
                      <div className="dp-divider" />
                      <button
                        className="dp-side-action"
                        disabled={busy || readOnly}
                        onClick={() =>
                          edit((value) => ({ ...value, activeSkinId: skinId }))
                        }
                      >
                        <Check size={15} />
                        设为桌宠默认皮肤
                      </button>
                      <p className="dp-hint">
                        皮肤贴图必须与对应原部件尺寸一致；未替换的部件沿用默认贴图。
                      </p>
                    </>
                  )}
                </>
              )}
              <DialogueInspector
                tab={tab}
                eventLabel={EVENTS.find((item) => item.id === eventName)?.label}
                reaction={reaction}
                whale={whale}
                draft={draft}
                config={config}
                readOnly={busy || readOnly}
                selectLine={preview.selectLine}
                editReaction={editReaction}
                edit={edit}
              />
              {tab === "habits" && (
                <>
                  <div className="dp-panel-heading">
                    <strong>习惯设置</strong>
                    <small>用户可临时调整</small>
                  </div>
                  <p className="dp-section-label">走动强度</p>
                  <div className="dp-segments">
                    {(
                      [
                        ["free", "常走动"],
                        ["calm", "多待着"],
                        ["off", "不乱动"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={habits.roam === id}
                        disabled={busy || readOnly}
                        onClick={() => editHabits({ roam: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="dp-field">
                    <span>桌宠高度 {habits.size} px</span>
                    <input
                      type="range"
                      aria-label="桌宠高度"
                      className="dp-size-slider"
                      style={
                        {
                          "--dp-slider-progress": `${((habits.size - 160) / 140) * 100}%`,
                        } as import("react").CSSProperties
                      }
                      min={160}
                      max={300}
                      step={10}
                      value={habits.size}
                      disabled={busy || readOnly}
                      onChange={(event) =>
                        editHabits({ size: Number(event.target.value) })
                      }
                    />
                  </label>
                  {(
                    [
                      ["draggable", "允许拖动"],
                      ["bubbles", "显示气泡"],
                      ["sound", "播放音效"],
                      ["edgeClimbing", "边缘攀爬"],
                      ["highGliding", "高处滑翔"],
                    ] as const
                  ).map(([id, label]) => (
                    <label className="dp-checkbox" key={id}>
                      <input
                        type="checkbox"
                        checked={habits[id]}
                        disabled={
                          readOnly ||
                          ((!whale ||
                            Boolean(
                              humanMotionUnavailable(draft.whaleModel),
                            )) &&
                            ["edgeClimbing", "highGliding"].includes(id))
                        }
                        onChange={(event) =>
                          editHabits({ [id]: event.target.checked })
                        }
                      />
                      <span>
                        {label}
                        {["edgeClimbing", "highGliding"].includes(id) &&
                        (!whale || humanMotionUnavailable(draft.whaleModel))
                          ? !whale
                            ? "（Live2D 暂不支持）"
                            : "（需更新动作资源）"
                          : ""}
                      </span>
                    </label>
                  ))}
                  <p className="dp-section-label">悬停按钮，最多 4 个</p>
                  <div className="dp-hover-actions">
                    {ACTIONS.map((action) => (
                      <button
                        key={action.id}
                        aria-pressed={habits.hoverActions?.includes(action.id)}
                        disabled={busy || readOnly}
                        onClick={() =>
                          editHabits({
                            hoverActions: habits.hoverActions?.includes(
                              action.id,
                            )
                              ? habits.hoverActions.filter(
                                  (id) => id !== action.id,
                                )
                              : [
                                  ...(habits.hoverActions ?? []),
                                  action.id,
                                ].slice(0, 4),
                          })
                        }
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {tab === "preview" && (
                <>
                  <div className="dp-panel-heading">
                    <strong>桌面试玩</strong>
                  </div>
                  <p className="dp-check">
                    <Check size={15} />
                    角色与皮肤素材独立保存
                  </p>
                  <p className="dp-check">
                    <Check size={15} />
                    点击、摸头、拖放可恢复待机
                  </p>
                  <p className="dp-check">
                    <Check size={15} />
                    限制在当前屏幕可用范围
                  </p>
                  <div className="dp-divider" />
                  <button
                    className="dp-primary dp-wide"
                    disabled={busy}
                    onClick={() => void launch()}
                  >
                    <CirclePlay size={15} />
                    {active ? "显示桌宠" : "放到桌面"}
                  </button>
                  <button
                    className="dp-wide"
                    disabled={busy}
                    onClick={() => void launchChat()}
                  >
                    启动桌宠并试聊
                  </button>
                  {active && (
                    <button
                      className="dp-wide"
                      onClick={() =>
                        void run(async () => {
                          await window.futurePropsDesktop?.closePet?.();
                          setActive(false);
                        })
                      }
                    >
                      收起桌宠
                    </button>
                  )}
                  <div className="dp-hint">
                    桌宠只会手动启动。桌宠包导出与公开发布留到下一阶段。
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}
      <Dialog.Root
        open={Boolean(leaving)}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dp-dialog-overlay" />
          <Dialog.Content className="dp-dialog">
            <Dialog.Title>离开未保存的桌宠工程？</Dialog.Title>
            <Dialog.Description>当前修改尚未保存。</Dialog.Description>
            <div className="dp-dialog-actions">
              <button onClick={() => setLeaving(null)}>继续编辑</button>
              <button
                className="dp-confirm"
                onClick={() => {
                  const next = leaving;
                  setDirty(false);
                  setLeaving(null);
                  next?.();
                }}
              >
                放弃修改
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
