import * as Tabs from "@radix-ui/react-tabs";
import { CardEditorTabs } from "./CardEditorTabs";
import { CardCandidateImages } from "./CardCandidateImages";
import { SceneStageBinding } from "./SceneStageBinding";
import { CardLibraryGroups } from "./CardLibraryGroups";
import { libraryFamilies } from "./cardFamilies";
import { useCardNameSort } from "./useCardNameSort";
import { useCardCreation } from "./useCardCreation";
import { useBackdropDismiss } from "@shared/ui/useBackdropDismiss";
import { useConfirmation } from "@shared/ui/useConfirmation";
import {
  importLibraryAssets,
  invalidateFileScope,
  uploadManagedFile,
} from "@features/files";
import { CardVoice } from "./CardVoice";
import { projectModelPath, projectModelsKey } from "../previs/projectModels";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDownAZ,
  ArrowUpRight,
  Images,
  Plus,
  Search,
  X,
} from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { SearchablePickerField } from "@shared/ui/SearchablePickerDialog";
import { CardAssetPicker, type PickedCardAsset } from "./CardAssetPicker";
import { ImagePreview } from "@shared/ui/ImagePreview";
import { WorkshopSearch } from "@shared/ui/WorkshopAppChrome";
import { getGenerationOptions, getVisualWorkshopProjects } from "../api";
import { visualWorkshopQueryKeys } from "../queryKeys";
import {
  cardsKey,
  generateCard,
  listCards,
  saveCard,
  type Card,
  type CardKind,
} from "./api";
import { cardKindInfo, cardKinds } from "./cardKinds";
import { placeCardImage } from "./cardMedia";
import { cardCandidateIds } from "./cardImages";
import { useCardCandidates } from "./useCardCandidates";
import "./creative.css";
import "./card-library.css";
import "./card-editor.css";
import emptyLibrary from "./design-library-empty.webp";

const emptyDescriptions: Record<CardKind, string> = {
  character: "把人物的外形、服装和参考图收在一张卡里，供各项目复用。",
  scene: "记录场景的空间、光线和陈设，方便在不同项目里复用。",
  prop: "保存道具的外观、材质和参考图，让不同项目使用同一套设定。",
};

const format = {
  character:
    "横版角色设定板，从左到右为头部特写、正面全身、严格侧面全身、背面全身。同一人、同一套服装，完整展示、简洁中性背景。",
  scene:
    "无人场景主视图，呈现固定陈设、空间布局、门窗通道、材质和主光，保留明确空间地标。",
  prop: "同一道具的 2×2 设定板，依次为正面、严格侧面、背面、关键细节，无人和手，清晰展示结构材质与状态。",
};

function cardPrompt(card: Card) {
  return [
    `${card.title}。 ${format[card.kind]}`,
    card.design,
    card.parent_asset_id
      ? "沿用参考图的主体身份与结构，只改变本卡写明的变体内容。"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function AssetCards({
  project,
  readOnly = false,
  fixedKind,
  initialCardId,
  onCloseCard,
  onOpenPrevis,
  onCreated,
}: {
  project?: string;
  readOnly?: boolean;
  fixedKind?: CardKind;
  initialCardId?: string;
  onCloseCard?: () => void;
  onOpenPrevis?: (id: string) => void;
  onCreated?: (card: Card) => Promise<void>;
}) {
  const client = useQueryClient();
  const key = cardsKey;
  const cards = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listCards(signal),
  });
  const [selectedKind, setSelectedKind] = useState<CardKind>("character");
  const kind = fixedKind ?? selectedKind;
  const { label, icon: KindIcon } = cardKindInfo[kind];
  const [active, setActive] = useState<string | undefined>(initialCardId);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const creation = useCardCreation(kind, label, setActive, onCreated);
  const { busy, error, add } = creation;
  const sorting = useCardNameSort("library");
  const card = cards.data?.find((entry) => entry.id === active);
  const search = filter.trim().toLowerCase();
  const families = libraryFamilies(
    cards.data ?? [],
    kind,
    includeArchived,
    search,
    sorting.sorted(kind),
  );
  const empty = cards.isSuccess && !families.length;
  const showIntro = empty && !search;

  const createButton = !readOnly && (
    <button
      type="button"
      className="creative-primary"
      aria-label={`新建${label}`}
      title={`新建${label}`}
      disabled={busy || !cards.data}
      onClick={() => void add()}
    >
      <Plus size={15} aria-hidden />
      <span>新建{label}</span>
    </button>
  );

  const editor = card ? (
    <CardEditor
      key={card.id}
      project={project}
      onOpenPrevis={onOpenPrevis}
      initial={card}
      readOnly={readOnly}
      creation={creation}
      onClose={() => {
        setActive(undefined);
        onCloseCard?.();
      }}
      onChanged={(next) =>
        client.setQueryData<Card[]>(key, (old) =>
          (old ?? []).map((item) => (item.id === next.id ? next : item)),
        )
      }
      onVariant={async (parent) => {
        await add(parent);
      }}
    />
  ) : null;
  if (initialCardId) return editor;
  return (
    <section
      aria-label={fixedKind ? label : "设定卡"}
      className="creative-card-library"
    >
      <header className="card-library-toolbar">
        {fixedKind ? (
          <strong>通用{label}</strong>
        ) : (
          <div
            className="card-library-categories"
            role="group"
            aria-label="设定类型"
          >
            {cardKinds.map((key) => {
              const { label: typeLabel, icon: Icon } = cardKindInfo[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={key === kind}
                  aria-label={typeLabel}
                  title={typeLabel}
                  className={key === kind ? "active" : undefined}
                  onClick={() => setSelectedKind(key)}
                >
                  <Icon size={14} aria-hidden />
                  <span>{typeLabel}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="card-library-actions">
          <button
            type="button"
            className="card-library-sort"
            aria-label={`${label}按名称排序`}
            title="按名称排序"
            aria-pressed={sorting.sorted(kind)}
            disabled={!cards.data?.some((card) => card.kind === kind)}
            onClick={() => sorting.sort(kind)}
          >
            <ArrowDownAZ size={14} aria-hidden />
            <span>按名称排序</span>
          </button>
          <WorkshopSearch
            label={`搜索${label}`}
            placeholder={`搜索${label}…`}
            value={filter}
            onChange={setFilter}
          />
          <button
            type="button"
            className="card-library-archive"
            aria-label="显示已归档"
            title="显示已归档"
            aria-pressed={includeArchived}
            onClick={() => setIncludeArchived(!includeArchived)}
          >
            <Archive size={14} aria-hidden />
            <span>显示已归档</span>
          </button>
          {!showIntro && createButton}
        </div>
      </header>
      {(error || cards.error) && (
        <p className="creative-feedback" role="alert">
          {error || apiErrorMessage(cards.error)}
        </p>
      )}
      {cards.isPending ? (
        <p className="creative-feedback" role="status">
          正在读取设定卡…
        </p>
      ) : showIntro ? (
        <div className="card-library-intro">
          <div className="card-library-intro-copy">
            <span className="card-library-intro-icon">
              <KindIcon size={19} aria-hidden />
            </span>
            <h2>暂无{label}</h2>
            <p>{emptyDescriptions[kind]}</p>
            {createButton}
          </div>
          <div className="card-library-art" aria-hidden="true">
            <img src={emptyLibrary} width="768" height="768" alt="" />
          </div>
        </div>
      ) : empty ? (
        <div className="creative-card-empty">
          <Search size={20} aria-hidden />
          <strong>没有匹配的{label}</strong>
          <button
            type="button"
            className="creative-quiet"
            onClick={() => setFilter("")}
          >
            清空搜索
          </button>
        </div>
      ) : null}
      {families.length > 0 && (
        <CardLibraryGroups
          families={families}
          galleryFamilies={libraryFamilies(
            cards.data ?? [],
            kind,
            includeArchived,
            "",
            sorting.sorted(kind),
          )}
          onOpen={setActive}
          onVariant={(parent) => void add(parent)}
          readOnly={readOnly}
          busy={busy}
        />
      )}
      {editor}
    </section>
  );
}

function CardEditor({
  project,
  initial,
  readOnly,
  onClose,
  onChanged,
  onVariant,
  creation,
  onOpenPrevis,
}: {
  project?: string;
  initial: Card;
  readOnly: boolean;
  onClose: () => void;
  onChanged: (card: Card) => void;
  onVariant: (parent: Card) => Promise<void>;
  creation: ReturnType<typeof useCardCreation>;
  onOpenPrevis?: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const { label, icon: KindIcon } = cardKindInfo[initial.kind];
  const [draft, setDraft] = useState(() => ({
    ...initial,
    candidate_asset_ids: cardCandidateIds(initial),
  }));
  const [editorTab, setEditorTab] = useState("design");
  const [dirty, setDirty] = useState(false);
  const [working, setBusy] = useState(false);
  const busy = working || creation.busy;
  const confirmation = useConfirmation({
    portalContainer: dialog.current,
    pending: busy,
  });
  const [notice, setNotice] = useState("");
  const [modelId, setModelId] = useState("");
  const [size, setSize] = useState("");
  const [prompt, setPrompt] = useState("");
  const [picker, setPicker] = useState<"image" | "model" | "audio">();
  const [pickedAssets, setPickedAssets] = useState<
    Record<string, PickedCardAsset>
  >({});
  const [generationProject, setGenerationProject] = useState(
    (initial.parent_asset_id &&
      initial.media_projects?.[initial.parent_asset_id]) ||
      project ||
      "",
  );
  const copies = useRef(new Map<string, string>());
  const canUseModels = useAccountPermission("models.use");
  const pendingRequest = useRef<{ key: string; id: string }>(null);
  const options = useQuery({
    queryKey: visualWorkshopQueryKeys.generationOptions,
    queryFn: getGenerationOptions,
    enabled: !readOnly && canUseModels,
  });
  const generationProjects = useQuery({
    queryKey: visualWorkshopQueryKeys.projects,
    queryFn: getVisualWorkshopProjects,
    enabled: !readOnly,
  });
  const projectChoices = (generationProjects.data?.items ?? []).map(
    ({ id, title }) => ({ id, label: title, icon: "folder" as const }),
  );
  const parentScope = draft.parent_asset_id
    ? draft.media_projects?.[draft.parent_asset_id]
    : null;
  const {
    tasks,
    ids: candidateIds,
    aliases,
    resolving,
  } = useCardCandidates(draft, copies.current);
  const models =
    options.data?.models.filter(
      (entry) =>
        entry.kind === "image" &&
        (!draft.parent_asset_id || entry.max_reference_images > 0),
    ) ?? [];
  const model = models.find((item) => item.id === modelId);

  async function copyToLibrary(asset: string, source: string) {
    const previous = copies.current.get(asset);
    if (previous) return previous;
    const result = await importLibraryAssets({
      sourceProjectId: source,
      assetIds: [asset],
    });
    const copied = result.items[0];
    if (!copied) throw new Error("素材未能保存到总文件");
    copies.current.set(asset, copied.id);
    void invalidateFileScope(client);
    void client.invalidateQueries({ queryKey: projectModelsKey("library") });
    return copied.id;
  }

  async function saveDraft(value: Card) {
    if (candidateIds.length > 80)
      throw new Error("候选图最多保留 80 张，请先整理候选图");
    let {
      adopted_asset_id: adopted,
      model_asset_key: modelKey,
      voice_asset_id: voice,
    } = value;
    if (adopted) {
      const item = pickedAssets[adopted];
      const task = tasks.find(
        ({ data }) => data?.result_asset_id === adopted,
      )?.data;
      const source = item
        ? item.projectId
        : task?.project_id || value.media_projects?.[adopted];
      if (source) adopted = await copyToLibrary(adopted, source);
    }
    if (voice) {
      const picked = pickedAssets[voice];
      const source = picked ? picked.projectId : value.media_projects?.[voice];
      if (source) voice = await copyToLibrary(voice, source);
    }
    if (modelKey) {
      const asset = /^assets\/project-models\/([a-f0-9-]{36})\.glb$/.exec(
        modelKey,
      )?.[1];
      const picked = pickedAssets[modelKey];
      const source = picked
        ? picked.projectId
        : asset && value.media_projects?.[asset];
      if (asset && source)
        modelKey = projectModelPath(await copyToLibrary(asset, source));
    }
    return saveCard({
      ...value,
      adopted_asset_id: adopted,
      candidate_asset_ids: cardCandidateIds(
        { ...value, adopted_asset_id: adopted },
        candidateIds,
        new Map([...aliases, ...copies.current]),
      ),
      model_asset_key: modelKey,
      voice_asset_id: voice,
    });
  }

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  async function close() {
    if (busy) return false;
    if (
      dirty &&
      !(await confirmation.confirm({
        title: "舍弃设定修改？",
        description: "尚未保存的设定修改将被舍弃。",
        confirmLabel: "舍弃修改",
        cancelLabel: "继续编辑",
      }))
    )
      return false;
    onClose();
    return true;
  }

  function edit(patch: Partial<Card>) {
    setDraft({
      ...draft,
      ...patch,
      candidate_asset_ids: [
        ...new Set([
          ...candidateIds,
          ...(patch.adopted_asset_id ? [patch.adopted_asset_id] : []),
        ]),
      ],
    });
    setDirty(true);
  }

  function apply(value: Card) {
    setDraft({ ...value, candidate_asset_ids: cardCandidateIds(value) });
    setDirty(false);
    onChanged(value);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setNotice(apiErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const backdrop = useBackdropDismiss(close);
  return (
    <dialog
      ref={dialog}
      {...backdrop}
      className="creative-dialog creative-card-dialog"
      aria-label={draft.title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="card-editor-header">
        <span className="card-editor-kind-icon">
          <KindIcon size={20} aria-hidden />
        </span>
        <div className="card-editor-heading">
          <span>
            {label}
            {draft.parent_id ? " · 变体" : ""}
            {draft.archived ? " · 已归档" : ""}
          </span>
          <h2>{draft.title}</h2>
        </div>
        <button
          type="button"
          className="creative-quiet card-editor-close"
          aria-label="关闭"
          onClick={close}
          disabled={busy}
        >
          <X size={19} aria-hidden />
        </button>
      </header>
      <div className="card-editor-scroll">
        <div className="card-editor-layout">
          <section className="card-editor-media" aria-label="采用图与候选图">
            <div className="card-editor-media-heading">
              <h3>采用图</h3>
              {draft.adopted_asset_id && (
                <a
                  className="card-editor-original"
                  href={`/v1/files/${draft.adopted_asset_id}/content`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看原图 <ArrowUpRight size={14} aria-hidden />
                </a>
              )}
            </div>
            <div className="card-editor-preview">
              {draft.adopted_asset_id ? (
                <ImagePreview
                  eager
                  size={1280}
                  alt={`${draft.title}的采用图`}
                  src={`/v1/files/${draft.adopted_asset_id}/content`}
                />
              ) : (
                <div className="card-editor-no-image">
                  <Images size={26} aria-hidden />
                  <span>暂无采用图</span>
                </div>
              )}
            </div>
            <CardCandidateImages
              ids={candidateIds}
              adoptedId={draft.adopted_asset_id}
              readOnly={readOnly}
              busy={busy}
              onAdopt={(id) => edit({ adopted_asset_id: id })}
            />
            {resolving && <p role="status">正在核对候选图…</p>}
            {tasks.some(
              ({ data, isPending }) =>
                isPending ||
                (data &&
                  !["completed", "failed", "cancelled"].includes(data.status)),
            ) && <p role="status">候选图正在生成…</p>}
            {tasks.flatMap(({ data }) =>
              data && (data.status === "failed" || data.status === "cancelled")
                ? [
                    <p role="status" key={data.id}>
                      {data.error_message || "候选图生成已结束"}
                    </p>,
                  ]
                : [],
            )}
          </section>
          <Tabs.Root
            value={
              editorTab === "generation" &&
              (readOnly || !canUseModels || draft.archived)
                ? "design"
                : editorTab
            }
            onValueChange={setEditorTab}
            className="card-editor-details"
            asChild
          >
            <section aria-label="设定详情">
              <CardEditorTabs
                readOnly={readOnly}
                canGenerate={canUseModels && !draft.archived}
              />
              <Tabs.Content value="design" className="card-editor-panel">
                <div className="card-editor-panel-heading">
                  <h3>基本设定</h3>
                  <p>记录外观与细节，让创作保持一致。</p>
                </div>
                {readOnly ? (
                  <dl className="card-editor-read-only">
                    <dt>描述</dt>
                    <dd>{draft.design || "暂无描述"}</dd>
                  </dl>
                ) : (
                  <div className="card-editor-fields">
                    <label>
                      名称
                      <input
                        value={draft.title}
                        maxLength={120}
                        disabled={busy}
                        onChange={(event) =>
                          edit({ title: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      描述
                      <textarea
                        className="card-editor-design"
                        rows={4}
                        value={draft.design ?? ""}
                        disabled={busy}
                        onChange={(event) =>
                          edit({ design: event.target.value })
                        }
                      />
                    </label>
                  </div>
                )}
                {draft.kind === "character" && (
                  <CardVoice
                    assetId={draft.voice_asset_id}
                    title={draft.title}
                    readOnly={readOnly}
                    busy={busy}
                    onChoose={() => setPicker("audio")}
                    onRemove={() => edit({ voice_asset_id: null })}
                    onUpload={(file) =>
                      run(async () => {
                        const uploaded = await uploadManagedFile(file);
                        await invalidateFileScope(client);
                        edit({ voice_asset_id: uploaded.id });
                      })
                    }
                  />
                )}
              </Tabs.Content>
              {!readOnly && (
                <Tabs.Content
                  value="materials"
                  className="card-editor-panel"
                  forceMount
                >
                  <div className="card-editor-panel-heading">
                    <h3>关联资源</h3>
                    <p>查看和管理此设定关联的图片与 3D 模型。</p>
                  </div>
                  <div className="card-editor-fields">
                    <div className="card-editor-select-field">
                      <span>采用图</span>
                      {draft.adopted_asset_id && (
                        <div className="card-editor-linked-image">
                          <ImagePreview
                            size={320}
                            alt={`${draft.title}已关联的采用图`}
                            src={`/v1/files/${draft.adopted_asset_id}/content`}
                          />
                          <a
                            href={`/v1/files/${draft.adopted_asset_id}/content`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            查看关联图片 <ArrowUpRight size={14} aria-hidden />
                          </a>
                        </div>
                      )}
                      <button
                        type="button"
                        className="searchable-picker-trigger"
                        aria-label="选择采用图"
                        aria-haspopup="dialog"
                        disabled={busy}
                        onClick={() => setPicker("image")}
                      >
                        <span>
                          {draft.adopted_asset_id
                            ? (pickedAssets[draft.adopted_asset_id]?.label ??
                              "更换采用图")
                            : "选择采用图"}
                        </span>
                        <Search size={15} aria-hidden />
                      </button>
                    </div>
                    <div className="card-editor-select-field">
                      <span>3D 模型</span>
                      <button
                        type="button"
                        className="searchable-picker-trigger"
                        aria-label="关联 3D 模型"
                        aria-haspopup="dialog"
                        disabled={busy}
                        onClick={() => setPicker("model")}
                      >
                        <span>
                          {draft.model_asset_key
                            ? (pickedAssets[draft.model_asset_key]?.label ??
                              "更换已关联模型")
                            : "关联 3D 模型"}
                        </span>
                        <Search size={15} aria-hidden />
                      </button>
                    </div>
                  </div>
                  {project && draft.kind === "scene" && (
                    <SceneStageBinding
                      project={project}
                      cardId={draft.id}
                      title={draft.title}
                      readOnly={readOnly}
                      onOpen={async (id) => {
                        if (await close()) onOpenPrevis?.(id);
                      }}
                    />
                  )}
                </Tabs.Content>
              )}
              {!readOnly && canUseModels && !draft.archived && (
                <Tabs.Content value="generation" className="card-editor-panel">
                  <div className="card-editor-panel-heading">
                    <h3>候选图生成</h3>
                    <p>根据当前设定生成新方案，结果会出现在候选图中。</p>
                  </div>
                  <div className="card-editor-fields">
                    <div className="card-editor-generation-fields">
                      <SearchablePickerField
                        title="生成任务归属项目"
                        searchLabel="搜索项目"
                        placeholder="选择生成任务归属项目"
                        value={generationProject}
                        items={
                          parentScope
                            ? projectChoices.filter(
                                ({ id }) => id === parentScope,
                              )
                            : projectChoices
                        }
                        disabled={busy}
                        onChange={setGenerationProject}
                      />
                      <CustomSelect
                        escapeClipping={false}
                        ariaLabel="图片模型"
                        placeholder="选择图片模型"
                        value={modelId}
                        disabled={busy}
                        options={models.map((item) => ({
                          value: item.id,
                          label: item.label,
                        }))}
                        onChange={(id) => {
                          setModelId(id);
                          const sizes =
                            models.find((item) => item.id === id)?.sizes ?? [];
                          setSize(
                            sizes.find(
                              (entry) =>
                                entry.startsWith("16:9") ||
                                entry.startsWith("1536x"),
                            ) ??
                              sizes[0] ??
                              "",
                          );
                        }}
                      />
                      {model && (
                        <CustomSelect
                          escapeClipping={false}
                          ariaLabel="图片尺寸"
                          value={size}
                          disabled={busy}
                          options={(model.sizes ?? []).map((entry) => ({
                            label: entry,
                            value: entry,
                          }))}
                          onChange={setSize}
                        />
                      )}
                    </div>
                    <label>
                      生成提示词
                      <textarea
                        disabled={busy}
                        rows={5}
                        value={prompt || cardPrompt(draft)}
                        onChange={(event) => setPrompt(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="creative-primary"
                      disabled={
                        busy ||
                        !model ||
                        !size ||
                        !generationProject ||
                        !draft.title.trim()
                      }
                      onClick={() =>
                        void run(async () => {
                          const current = dirty
                            ? await saveDraft(draft)
                            : draft;
                          if (dirty) apply(current);
                          if (current.parent_asset_id)
                            await placeCardImage(
                              generationProject,
                              current.parent_asset_id,
                              parentScope,
                            );
                          const input = {
                            expected_revision: current.revision,
                            model_id: modelId,
                            size,
                            prompt: (prompt || cardPrompt(current)).trim(),
                          };
                          const key = JSON.stringify([
                            generationProject,
                            input,
                          ]);
                          if (pendingRequest.current?.key !== key)
                            pendingRequest.current = {
                              key,
                              id: crypto.randomUUID(),
                            };
                          await generateCard(generationProject, current.id, {
                            ...input,
                            request_id: pendingRequest.current.id,
                          });
                          pendingRequest.current = null;
                          const cards = await client.fetchQuery({
                            queryKey: cardsKey,
                            queryFn: () => listCards(),
                            staleTime: 0,
                          });
                          const saved = cards.find(
                            (entry) => entry.id === current.id,
                          );
                          if (saved) apply(saved);
                        })
                      }
                    >
                      生成候选图
                    </button>
                  </div>
                </Tabs.Content>
              )}
            </section>
          </Tabs.Root>
        </div>
      </div>
      {creation.error && (
        <p className="creative-feedback" role="alert">
          {creation.error}
          {creation.canRetry && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void creation.retry()}
            >
              重试添加
            </button>
          )}
        </p>
      )}
      {notice && (
        <p role="alert" className="card-editor-feedback">
          {notice}{" "}
          <button
            className="creative-quiet"
            onClick={async () => {
              if (
                !(await confirmation.confirm({
                  title: "载入已保存版本？",
                  description: "当前未保存的设定草稿将被舍弃。",
                  confirmLabel: "载入已保存版本",
                  cancelLabel: "保留草稿",
                }))
              )
                return;
              await run(async () => {
                const fresh = await listCards();
                const item = fresh.find((entry) => entry.id === draft.id);
                if (item) apply(item);
              });
            }}
          >
            载入已保存版本
          </button>
        </p>
      )}
      {picker && !readOnly && (
        <CardAssetPicker
          kind={picker}
          project={project}
          projects={projectChoices}
          value={
            picker === "image"
              ? draft.adopted_asset_id
              : picker === "audio"
                ? draft.voice_asset_id
                : draft.model_asset_key
          }
          onClose={() => setPicker(undefined)}
          onChoose={(item) => {
            if (item)
              setPickedAssets((current) => ({ ...current, [item.id]: item }));
            const id = item?.id ?? null;
            if (picker === "image") {
              if (id !== draft.adopted_asset_id) edit({ adopted_asset_id: id });
            } else if (picker === "audio") {
              if (id !== draft.voice_asset_id) edit({ voice_asset_id: id });
            } else if (id !== draft.model_asset_key) {
              edit({ model_asset_key: id });
            }
          }}
        />
      )}
      {!readOnly && (
        <footer className="card-editor-footer">
          <div className="card-editor-footer-group">
            <button
              type="button"
              className="creative-quiet"
              disabled={busy || dirty}
              onClick={() =>
                void run(async () =>
                  apply(
                    await saveCard({
                      ...draft,
                      archived: !draft.archived,
                    }),
                  ),
                )
              }
            >
              {draft.archived ? "恢复卡片" : "归档"}
            </button>
            <button
              type="button"
              className="creative-quiet"
              disabled={
                busy || dirty || !draft.adopted_asset_id || draft.archived
              }
              onClick={() => void run(() => onVariant(draft))}
            >
              创建变体
            </button>
          </div>
          <div className="card-editor-footer-group">
            {dirty && (
              <span className="card-editor-meta" role="status">
                有未保存的修改
              </span>
            )}
            <button
              type="button"
              className="creative-primary"
              disabled={!dirty || busy || !draft.title.trim()}
              onClick={() =>
                void run(async () => apply(await saveDraft(draft)))
              }
            >
              保存设定卡
            </button>
          </div>
        </footer>
      )}
      {confirmation.dialog}
    </dialog>
  );
}
