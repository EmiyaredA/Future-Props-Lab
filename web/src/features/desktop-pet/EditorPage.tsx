import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CirclePlay,
  Plus,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { api, ApiError, unwrap } from "@platform/api/client";
import {
  getDocument,
  getProject,
  saveDocument,
  syncSource,
  uploadSkin,
  type PetConfig,
  type PetDocument,
  type PetHabits,
  type PetProject,
  type PetReaction,
} from "./api";
import { PetRenderer } from "./PetRenderer";
import "./workshop.css";

type Tab = "look" | "events" | "habits" | "preview";
type EventName = "idle" | "click" | "pet" | "grab" | "drop" | "roam";
const EVENTS: { id: EventName; label: string; detail: string }[] = [
  { id: "idle", label: "待机", detail: "循环" },
  { id: "click", label: "点击身体", detail: "点击" },
  { id: "pet", label: "摸头", detail: "头部热区" },
  { id: "grab", label: "拖起", detail: "开始拖动" },
  { id: "drop", label: "放下", detail: "结束拖动" },
  { id: "roam", label: "自主走动", detail: "空闲" },
];
const ACTIONS: { id: "dress" | "roam" | "hide" | "settings"; label: string }[] =
  [
    { id: "dress", label: "装扮" },
    { id: "roam", label: "走动" },
    { id: "hide", label: "隐藏" },
    { id: "settings", label: "设置" },
  ];
const EMPTY_REACTION: PetReaction = {
  motionId: null,
  expressionId: null,
  bubble: "",
  sound: "none",
};
const DEFAULT_HABITS: PetHabits = {
  roam: "calm",
  size: 220,
  draggable: true,
  bubbles: true,
  sound: true,
  hoverActions: ["dress", "roam", "hide"],
};

function normalize(config: PetConfig): PetConfig {
  return {
    schemaVersion: 1,
    skins: config.skins ?? [],
    activeSkinId: config.activeSkinId ?? null,
    events: config.events ?? {},
    habits: { ...DEFAULT_HABITS, ...config.habits },
  };
}

function Picker({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="dp-field">
      <span>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="dp-picker"
          disabled={disabled}
          aria-label={label}
        >
          {options.find((item) => item.value === value)?.label ?? "未设置"}
          <ChevronDown size={14} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dp-menu" sideOffset={4}>
            {options.map((option) => (
              <DropdownMenu.Item
                key={option.value}
                onSelect={() => onChange(option.value)}
              >
                {option.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </label>
  );
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
  const [skinId, setSkinId] = useState<string | null>(null);
  const [eventName, setEventName] = useState<EventName>("click");
  const [reactionKey, setReactionKey] = useState(0);
  const [playingEvent, setPlayingEvent] = useState<EventName>("idle");
  const [previewBubble, setPreviewBubble] = useState("");
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
        setSkinId(documentValue.config.activeSkinId ?? null);
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
  const skins = config?.skins ?? [];
  const selectedSkin = skins.find((item) => item.id === skinId);
  const reaction = config?.events?.[eventName] ?? EMPTY_REACTION;
  const habits = config?.habits ?? DEFAULT_HABITS;
  const assets = useMemo(() => {
    if (!snapshot) return [];
    const names = new Map<string, string>();
    for (const part of snapshot.character.parts ?? [])
      if (!names.has(part.assetId)) names.set(part.assetId, part.name);
    return [...names].map(([id, name]) => ({ id, name }));
  }, [snapshot]);

  const edit = (update: (value: PetConfig) => PetConfig) => {
    if (readOnly) return;
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
          ...EMPTY_REACTION,
          ...value.events?.[eventName],
          ...patch,
        },
      },
    }));
  const editHabits = (patch: Partial<PetHabits>) =>
    edit((value) => ({
      ...value,
      habits: { ...DEFAULT_HABITS, ...value.habits, ...patch },
    }));
  const playPreview = (name: EventName) => {
    setPlayingEvent(name);
    setReactionKey((value) => value + 1);
    setPreviewBubble(config?.events?.[name]?.bubble ?? "");
  };
  useEffect(() => {
    if (!previewBubble) return;
    const timer = window.setTimeout(() => setPreviewBubble(""), 3200);
    return () => window.clearTimeout(timer);
  }, [previewBubble, reactionKey]);
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
      setSkinId(documentValue.config.activeSkinId ?? null);
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
      if (!project || !snapshot) return;
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

  return (
    <section className="dp-editor">
      <header className="dp-editor-header">
        <button className="dp-back" onClick={leave} aria-label="返回桌宠项目">
          <ArrowLeft size={18} />
        </button>
        <div className="dp-editor-title">
          <strong>{project?.title ?? "桌宠项目"}</strong>
          <small>
            {dirty ? "未保存修改" : "已保存"} · 来源 r
            {project?.sourceRevision ?? "—"}
          </small>
        </div>
        <nav aria-label="桌宠编辑步骤">
          {(
            [
              ["look", "形象"],
              ["events", "交互"],
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
      {error && (
        <div className="dp-editor-alert" role="alert">
          {error}
          {conflict && (
            <button onClick={() => void reload()}>载入最新版本</button>
          )}
        </div>
      )}
      {!draft || !config ? (
        <div className="dp-loading">正在加载桌宠工程…</div>
      ) : (
        <div className="dp-editor-body">
          <aside className="dp-editor-left">
            {tab === "look" && (
              <>
                <div className="dp-panel-heading">
                  <strong>形象与皮肤</strong>
                  <small>{skins.length} 套</small>
                </div>
                <div className="dp-source-card">
                  <strong>{project?.sourceTitle}</strong>
                  <small>
                    Live2D 工坊 · 固定版本 r{project?.sourceRevision}
                  </small>
                </div>
                <p className="dp-section-label">皮肤列表</p>
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
                      onChange={(event) => setNewSkinName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addSkin();
                      }}
                    />
                    <button
                      onClick={addSkin}
                      disabled={!newSkinName.trim()}
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
            {tab === "events" && (
              <>
                <div className="dp-panel-heading">
                  <strong>触发事件</strong>
                  <small>6 种</small>
                </div>
                {EVENTS.map((item) => (
                  <button
                    key={item.id}
                    className="dp-side-item"
                    aria-pressed={eventName === item.id}
                    onClick={() => setEventName(item.id)}
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
                  装扮、走动、隐藏、设置最多选择四个；运行时改动只影响当前会话。
                </div>
              </>
            )}
            {tab === "preview" && (
              <>
                <div className="dp-panel-heading">
                  <strong>试玩与来源</strong>
                </div>
                <div className="dp-source-card">
                  <strong>来源角色 r{project?.sourceRevision}</strong>
                  <small>{project?.sourceTitle}</small>
                </div>
                <button
                  className="dp-side-action"
                  disabled={busy || readOnly}
                  onClick={() => void updateSource()}
                >
                  <RefreshCw size={15} />
                  检查并更新来源
                </button>
                <div className="dp-hint">
                  更新来源前会检查动作、表情和换肤贴图的兼容性；不兼容时保留当前快照。
                </div>
              </>
            )}
          </aside>
          <main className="dp-editor-center">
            <div className="dp-stage-tools">
              {tab === "events" ? (
                <button onClick={() => playPreview(eventName)}>
                  ▶ 播放事件
                </button>
              ) : (
                <span>{tab === "look" ? "透明取景" : "模拟桌面"}</span>
              )}
              <span>
                {tab === "events"
                  ? EVENTS.find((item) => item.id === eventName)?.label
                  : `${habits.size} px`}
              </span>
            </div>
            {tab === "look" || tab === "events" ? (
              <div className="dp-checker-stage">
                <span className="dp-stage-badge">
                  {tab === "look"
                    ? (selectedSkin?.name ?? "默认形象")
                    : EVENTS.find((item) => item.id === eventName)?.label}
                </span>
                <div className="dp-character-frame">
                  <PetRenderer
                    document={draft}
                    skinId={skinId}
                    eventName={tab === "events" ? playingEvent : "idle"}
                    reactionKey={reactionKey}
                  />
                </div>
                {tab === "events" && previewBubble && (
                  <div className="dp-desktop-bubble">{previewBubble}</div>
                )}
              </div>
            ) : (
              <div className="dp-desktop-stage">
                <div className="dp-desktop-menubar">
                  Future Props Lab · 文件 · 编辑 · 视图
                </div>
                <div className="dp-desktop-window">
                  <div>正在工作的窗口</div>
                  <span />
                  <span />
                  <span />
                </div>
                <button
                  type="button"
                  aria-label="触摸桌宠，试听反应"
                  className="dp-desktop-pet"
                  style={{ height: habits.size, width: habits.size * 0.75 }}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    playPreview(
                      event.clientY < bounds.top + bounds.height * 0.48
                        ? "pet"
                        : "click",
                    );
                  }}
                >
                  <PetRenderer
                    document={draft}
                    skinId={skinId}
                    eventName={playingEvent}
                    reactionKey={reactionKey}
                  />
                </button>
                {habits.bubbles && previewBubble && (
                  <div className="dp-desktop-bubble">{previewBubble}</div>
                )}
                <div className="dp-desktop-state">
                  {habits.roam === "off"
                    ? "不乱动"
                    : habits.roam === "free"
                      ? "常走动"
                      : "多待着"}{" "}
                  · 透明区域穿透
                </div>
              </div>
            )}
            <footer className="dp-stage-footer">
              <span>
                角色画布 {draft.character.width} × {draft.character.height}
              </span>
              <span>
                {tab === "preview" ? "macOS 桌面运行预览" : "角色底边锚点"}
              </span>
            </footer>
          </main>
          <aside className="dp-editor-right">
            {tab === "look" && (
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
                        disabled={readOnly}
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
                          <label className="dp-upload">
                            <Upload size={13} />
                            上传 PNG
                            <input
                              type="file"
                              accept="image/png"
                              hidden
                              disabled={busy || readOnly}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void upload(item.id, file);
                              }}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                    <button
                      className="dp-side-action"
                      disabled={readOnly}
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
                  disabled={readOnly}
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
            {tab === "events" && (
              <>
                <div className="dp-panel-heading">
                  <strong>
                    {EVENTS.find((item) => item.id === eventName)?.label}
                  </strong>
                  <small>事件属性</small>
                </div>
                <Picker
                  label="动作"
                  value={reaction.motionId ?? ""}
                  options={[
                    { value: "", label: "无动作" },
                    ...(draft.character.motions ?? []).map((motion) => ({
                      value: motion.id,
                      label: motion.name,
                    })),
                  ]}
                  onChange={(value) =>
                    editReaction({ motionId: value || null })
                  }
                  disabled={readOnly}
                />
                <Picker
                  label="表情"
                  value={reaction.expressionId ?? ""}
                  options={[
                    { value: "", label: "无表情" },
                    ...(draft.character.expressions ?? []).map(
                      (expression) => ({
                        value: expression.id,
                        label: expression.name,
                      }),
                    ),
                  ]}
                  onChange={(value) =>
                    editReaction({ expressionId: value || null })
                  }
                  disabled={readOnly}
                />
                <label className="dp-field">
                  <span>气泡文案</span>
                  <textarea
                    disabled={readOnly}
                    maxLength={140}
                    value={reaction.bubble}
                    placeholder="可选；留空则不显示"
                    onChange={(event) =>
                      editReaction({ bubble: event.target.value })
                    }
                  />
                </label>
                <Picker
                  label="音效"
                  value={reaction.sound}
                  options={[
                    { value: "none", label: "无音效" },
                    { value: "tap", label: "轻点" },
                    { value: "chime", label: "提示音" },
                  ]}
                  onChange={(value) =>
                    editReaction({ sound: value as PetReaction["sound"] })
                  }
                  disabled={readOnly}
                />
                <div className="dp-hint">
                  动作与表情并行播放，事件结束自动回到待机。音效是内置提示音，不执行脚本。
                </div>
              </>
            )}
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
                      disabled={readOnly}
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
                    min={160}
                    max={300}
                    step={10}
                    value={habits.size}
                    disabled={readOnly}
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
                  ] as const
                ).map(([id, label]) => (
                  <label className="dp-checkbox" key={id}>
                    <input
                      type="checkbox"
                      checked={habits[id]}
                      disabled={readOnly}
                      onChange={(event) =>
                        editHabits({ [id]: event.target.checked })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
                <p className="dp-section-label">悬停按钮，最多 4 个</p>
                <div className="dp-hover-actions">
                  {ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      aria-pressed={habits.hoverActions?.includes(action.id)}
                      disabled={readOnly}
                      onClick={() =>
                        editHabits({
                          hoverActions: habits.hoverActions?.includes(action.id)
                            ? habits.hoverActions.filter(
                                (id) => id !== action.id,
                              )
                            : [...(habits.hoverActions ?? []), action.id],
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
