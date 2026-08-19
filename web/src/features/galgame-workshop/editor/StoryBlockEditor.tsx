import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlignLeft,
  AudioLines,
  BadgeInfo,
  BellRing,
  Blend,
  BookOpen,
  Braces,
  Camera,
  Check,
  Clock3,
  CircleCheck,
  CircleStop,
  Clapperboard,
  ContactRound,
  CornerDownLeft,
  Eraser,
  Eye,
  EyeOff,
  Flag,
  FlipHorizontal2,
  Film,
  Frame,
  GitBranch,
  GitMerge,
  GalleryHorizontal,
  Gauge,
  ImageOff,
  ImagePlus,
  Layers2,
  MapPinned,
  Maximize2,
  MessageCircle,
  MessageCircleMore,
  MonitorPlay,
  MessageSquareText,
  Music2,
  Palette,
  PanelsTopLeft,
  PlayCircle,
  Plus,
  Quote,
  RectangleHorizontal,
  RectangleVertical,
  Repeat2,
  RotateCcw,
  ScanFace,
  ScanLine,
  Search,
  Settings2,
  SlidersHorizontal,
  SlidersVertical,
  Sparkles,
  StickyNote,
  Subtitles,
  SunMedium,
  Target,
  Timer,
  Undo2,
  UserRound,
  UserRoundMinus,
  UserRoundPlus,
  Variable,
  Volume2,
  WandSparkles,
  Workflow,
  Hourglass,
  Zap,
  type LucideIcon,
  X,
} from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  sameDialogueGroup,
  storyBlockBundles,
  type StoryBlockBundle,
} from "@features/galgame-workshop/editor/blockFlow";
import { type GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import { type BlockKind } from "@features/galgame-workshop/editor/model";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import {
  BLOCK_REGISTRY,
  CURTAIN_MODE_OPTIONS,
  WAIT_DURATION_PRESETS,
} from "@features/galgame-workshop/editor/blockRegistry";
import { blockContextSettings } from "@features/galgame-workshop/editor/blockContextSettings";
import {
  RichTextEditor,
  RichTextView,
} from "@features/galgame-workshop/editor/RichTextEditor";
import {
  characterExpressionAssetId,
  dialogueDisplayName,
  plainRichText,
  richTextDocument,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";

const BLOCK_LABELS = Object.fromEntries(
  Object.entries(BLOCK_REGISTRY).map(([type, capability]) => [
    type,
    capability.label,
  ]),
) as Record<BlockKind, string>;

const AUDIO_LABELS = {
  bgm: "背景音乐",
  ambient: "环境音",
  sfx: "音效",
} as const;

type AudioChannel = keyof typeof AUDIO_LABELS;

/**
 * Keep the command palette legible at a glance. The old fallback made almost
 * every Block look like a text command, which was especially noisy in the
 * four insertion columns. This map is deliberately exhaustive so a new Block
 * kind cannot silently fall back to a generic glyph.
 */
const BLOCK_ICONS = {
  narration: Quote,
  dialogue: MessageCircleMore,
  storyParagraph: AlignLeft,
  paragraphParams: SlidersHorizontal,
  systemMessage: BellRing,
  comment: StickyNote,
  wait: Clock3,
  scene: MapPinned,
  destroyScene: Eraser,
  showCharacter: UserRoundPlus,
  removeCharacter: UserRoundMinus,
  showCg: ImagePlus,
  hideCg: ImageOff,
  camera: Camera,
  resetCamera: RotateCcw,
  audio: Music2,
  particle: Sparkles,
  stageAnimation: Clapperboard,
  floatingText: Subtitles,
  curtain: EyeOff,
  video: Film,
  animateSprite: PlayCircle,
  autoPlay: MonitorPlay,
  switchDialogueStyle: PanelsTopLeft,
  portraitStyleRule: UserRound,
  gallery: GalleryHorizontal,
  branch: GitBranch,
  if: GitMerge,
  setVariable: Variable,
  callFragment: Workflow,
  endChapter: Flag,
  returnToEntry: Undo2,
} satisfies Record<BlockKind, LucideIcon>;

function blockIcon(type: BlockKind) {
  const Icon = BLOCK_ICONS[type];
  return <Icon aria-hidden />;
}

/**
 * Context settings need their own semantic glyphs. A dialogue card can have
 * portrait, visibility, voice, and timing commands side by side; repeating
 * the card's main icon for all of them hides those differences.
 */
function contextSettingIcon(
  settingId: string,
  label: string,
  sectionLabel: string,
  blockType: BlockKind,
) {
  const key = settingId
    .replace(`context-${blockType}-`, "")
    .toLocaleLowerCase("en-US");
  const text = `${key} ${label} ${sectionLabel}`.toLocaleLowerCase("zh-CN");
  let Icon: LucideIcon = Settings2;
  if (key === "mode-fullscreen") Icon = Maximize2;
  else if (key === "mode-letterbox") Icon = RectangleHorizontal;
  else if (key === "mode-pillarbox") Icon = RectangleVertical;
  else if (key === "mode-frame") Icon = Frame;
  else if (key === "action-show") Icon = EyeOff;
  else if (key === "action-hide") Icon = Eye;
  else if (key === "duration-0") Icon = Zap;
  else if (key.startsWith("duration-")) Icon = Timer;
  else if (key === "action-play") Icon = PlayCircle;
  else if (key === "action-stop") Icon = CircleStop;
  else if (key === "loop") Icon = Repeat2;
  else if (key === "wait") Icon = Hourglass;
  else if (/portrait|立绘|角色|头像/.test(text))
    Icon =
      key.includes("solo") || label.includes("单人")
        ? ScanFace
        : key.includes("dialogueavatar") || label.includes("对白")
          ? ContactRound
          : UserRound;
  else if (/hide-dialogue|对话框|对白后/.test(text)) Icon = MessageCircle;
  else if (/voice|配音|音量|声音|audio/.test(text)) Icon = Volume2;
  else if (/channel|通道/.test(text)) Icon = AudioLines;
  else if (/duration|时长|delay|延迟|等待|wait/.test(text)) Icon = Timer;
  else if (/speed|速度|速率/.test(text)) Icon = Gauge;
  else if (/fade|淡入|淡出|transition/.test(text)) Icon = Blend;
  else if (/flip|翻转/.test(text)) Icon = FlipHorizontal2;
  else if (/position|位置|target|目标/.test(text)) Icon = Target;
  else if (/fit|适配|placement|层级|叠放/.test(text)) Icon = ScanLine;
  else if (/loop|循环/.test(text)) Icon = Repeat2;
  else if (/preset|预设|样式|主题/.test(text)) Icon = Palette;
  else if (/density|密度/.test(text)) Icon = Layers2;
  else if (/continuous|持续/.test(text)) Icon = Activity;
  else if (/volume|opacity|不透明|亮度|颜色/.test(text)) Icon = SunMedium;
  else if (/clear|清空|销毁/.test(text)) Icon = Eraser;
  else if (/operator|运算|变量/.test(text)) Icon = Braces;
  else if (/unlock|鉴赏/.test(text)) Icon = GalleryHorizontal;
  else if (/condition|条件/.test(text)) Icon = GitMerge;
  else if (/branch|选项/.test(text)) Icon = GitBranch;
  else if (/call|调用|fragment/.test(text)) Icon = CornerDownLeft;
  else if (/end|结束/.test(text)) Icon = Flag;
  else if (/return|返回/.test(text)) Icon = Undo2;
  else if (/action|动作|开启|关闭|播放|停止/.test(text)) Icon = CircleCheck;
  else if (/reveal|呈现|显示/.test(text)) Icon = WandSparkles;
  else if (/read|已读|历史/.test(text)) Icon = BookOpen;
  else if (/easing|缓动|控制/.test(text)) Icon = SlidersVertical;
  else if (/mode|模式|tone|语义/.test(text)) Icon = BadgeInfo;
  else if (/stop|停止/.test(text)) Icon = CircleStop;
  return <Icon aria-hidden />;
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
  if (block.type === "showCg")
    return (
      document.cgs?.find((candidate) => candidate.id === block.cgId)?.name ??
      "未知 CG"
    );
  if (block.type === "hideCg") return "隐藏当前剧情 CG";
  if (block.type === "showCharacter")
    return `登场 · ${
      document.characters?.find(
        (character) => character.id === block.characterId,
      )?.name ?? "未知角色"
    }`;
  if (block.type === "removeCharacter")
    return block.all
      ? "全部角色退场"
      : `退场 · ${
          document.characters?.find(
            (character) => character.id === block.characterId,
          )?.name ?? "未知角色"
        }`;
  if (block.type === "audio") {
    if (block.action === "stop") return `停止${AUDIO_LABELS[block.channel]}`;
    const asset = (document.assets ?? []).find(
      (candidate) => candidate.id === block.assetId,
    );
    return asset?.type === "audio" ? asset.label : "未绑定声音";
  }
  if (block.type === "branch")
    return block.choices
      .map((choice) => {
        const target = chapter.fragments?.find(
          (fragment) => fragment.id === choice.targetFragmentId,
        );
        return `${choice.text || "未命名选项"} → ${target?.title ?? "未知目标"}`;
      })
      .join(" · ");
  if (block.type === "endChapter") return block.label;
  return "";
}

function blockPreviewFileId(
  block: GalgameStoryBlock,
  document: GalgameStoryProject,
) {
  let assetId: string | undefined;
  if (block.type === "scene") {
    const scene = document.scenes?.find(
      (candidate) => candidate.id === block.sceneId,
    );
    assetId = scene?.layers?.[0]?.assetId;
  } else if (block.type === "showCg") {
    const cg = document.cgs?.find((candidate) => candidate.id === block.cgId);
    const variant = cg?.variants?.find(
      (candidate) => candidate.id === (block.variantId ?? cg.defaultVariantId),
    );
    assetId = variant?.assetId;
  }
  return document.assets?.find((candidate) => candidate.id === assetId)?.fileId;
}

type InsertCommand = {
  id: string;
  label: string;
  group: "角色" | "文本" | "演出" | "逻辑";
  icon: ReturnType<typeof blockIcon>;
  description: string;
  checked?: boolean;
  closeAfterRun?: boolean;
  disabled?: boolean;
  searchText?: string;
  run: () => void;
};

type ContextCommandSection = {
  label: string;
  commands: InsertCommand[];
};

const INSERT_GROUPS = ["角色", "文本", "演出", "逻辑"] as const;
const CATEGORY_LABELS = {
  character: "角色",
  text: "文本",
  stage: "演出",
  logic: "逻辑",
} as const;

function BlockInsertPalette({
  anchor,
  beforeBundleId,
  selectedBlock,
  story,
  hasTerminator,
  onClose,
  onBlock,
  onEditProperties,
  onAddBlock,
  onAddAllCharacters,
  onAddAudio,
}: {
  anchor: HTMLElement;
  beforeBundleId?: string;
  selectedBlock?: GalgameStoryBlock;
  story: GalgameStoryProject;
  hasTerminator: boolean;
  onClose: (restoreFocus: boolean) => void;
  onBlock: (block: GalgameStoryBlock) => void;
  onEditProperties: () => void;
  onAddBlock: (kind: BlockKind, beforeBundleId?: string) => void;
  onAddAllCharacters: (beforeBundleId?: string) => void;
  onAddAudio: (
    action: "play" | "stop",
    channel: AudioChannel,
    beforeBundleId?: string,
  ) => void;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState("");
  const [placement, setPlacement] = useState<CSSProperties>();

  const selectedGroup = selectedBlock
    ? CATEGORY_LABELS[BLOCK_REGISTRY[selectedBlock.type].category]
    : "文本";
  const contextSections: ContextCommandSection[] = (() => {
    if (!selectedBlock) return [];
    const context = blockContextSettings(selectedBlock, story);
    const sections = context.sections.map((item) => ({
      label: item.label,
      commands: item.settings.map((setting): InsertCommand => ({
        id: setting.id,
        label: setting.label,
        group: selectedGroup,
        icon: contextSettingIcon(
          setting.id,
          setting.label,
          item.label,
          selectedBlock.type,
        ),
        checked: setting.checked,
        disabled: setting.disabled,
        description: setting.description,
        searchText: `${BLOCK_LABELS[selectedBlock.type]} ${item.label}`,
        closeAfterRun: false,
        run: () => onBlock(setting.apply(selectedBlock)),
      })),
    }));
    if (context.includeInspector)
      sections.push({
        label: "完整设置",
        commands: [
          {
            id: "context-open-inspector",
            label: "在右侧属性中编辑",
            group: selectedGroup,
            icon: <Settings2 aria-hidden />,
            description: "复杂内容、素材和引用设置可在右侧属性面板中完整编辑。",
            searchText: `${BLOCK_LABELS[selectedBlock.type]} 完整设置 属性 检查器`,
            closeAfterRun: true,
            run: onEditProperties,
          },
        ],
      });
    return sections;
  })();
  const commands: InsertCommand[] = [
    ...(Object.keys(BLOCK_REGISTRY) as BlockKind[])
      .filter((kind) => kind !== "audio")
      .map((kind): InsertCommand => {
        const capability = BLOCK_REGISTRY[kind];
        return {
          id: `insert-${kind}`,
          label: capability.label,
          group: CATEGORY_LABELS[capability.category],
          icon: blockIcon(kind),
          description: `在当前选中卡片前插入“${capability.label}” Block。`,
          closeAfterRun: true,
          disabled:
            hasTerminator &&
            (kind === "endChapter" || kind === "returnToEntry"),
          run: () => onAddBlock(kind, beforeBundleId),
        };
      }),
    {
      id: "insert-remove-all-characters",
      label: "全部退场",
      group: "角色",
      icon: blockIcon("removeCharacter"),
      description: "在当前位置插入全部角色退场 Block。",
      closeAfterRun: true,
      run: () => onAddAllCharacters(beforeBundleId),
    },
    ...(Object.keys(AUDIO_LABELS) as AudioChannel[]).map(
      (channel): InsertCommand => ({
        id: `insert-play-${channel}`,
        label: AUDIO_LABELS[channel],
        group: "演出",
        icon: <Music2 aria-hidden />,
        description: `播放或切换${AUDIO_LABELS[channel]}。`,
        closeAfterRun: true,
        run: () => onAddAudio("play", channel, beforeBundleId),
      }),
    ),
    ...(Object.keys(AUDIO_LABELS) as AudioChannel[]).map(
      (channel): InsertCommand => ({
        id: `insert-stop-${channel}`,
        label: `停止${AUDIO_LABELS[channel]}`,
        group: "演出",
        icon: <Volume2 aria-hidden />,
        description: `停止当前${AUDIO_LABELS[channel]}通道。`,
        closeAfterRun: true,
        run: () => onAddAudio("stop", channel, beforeBundleId),
      }),
    ),
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const matchesQuery = (command: InsertCommand) =>
    `${command.label} ${command.group} ${command.description} ${command.searchText ?? ""}`
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery);
  const filteredCommands = commands.filter(matchesQuery);
  const filteredContextSections = contextSections
    .map((section) => ({
      ...section,
      commands: section.commands.filter(matchesQuery),
    }))
    .filter((section) => section.commands.length);
  const visibleCommands = [
    ...filteredContextSections.flatMap((section) => section.commands),
    ...filteredCommands,
  ];
  const [activeCommandId, setActiveCommandId] = useState<string>();
  const activeCommand =
    visibleCommands.find((command) => command.id === activeCommandId) ??
    visibleCommands[0];

  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.getBoundingClientRect();
      const viewportPadding = 16;
      const width = Math.min(1120, window.innerWidth - viewportPadding * 2);
      const maxHeight = Math.min(720, window.innerHeight - viewportPadding * 2);
      const left = Math.max(
        viewportPadding,
        Math.min(bounds.left, window.innerWidth - width - viewportPadding),
      );
      const top = Math.max(
        viewportPadding,
        Math.min(
          bounds.top + Math.min(bounds.height, 28),
          window.innerHeight - maxHeight - viewportPadding,
        ),
      );
      setPlacement({ left, top, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose(true);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const enabledCommands = visibleCommands.filter(
    (command) => !command.disabled,
  );
  const focusCommand = (direction: 1 | -1) => {
    if (!enabledCommands.length) return;
    const current = enabledCommands.findIndex(
      (command) =>
        commandRefs.current.get(command.id) === document.activeElement,
    );
    const next =
      current < 0
        ? direction > 0
          ? 0
          : enabledCommands.length - 1
        : (current + direction + enabledCommands.length) %
          enabledCommands.length;
    commandRefs.current.get(enabledCommands[next].id)?.focus();
  };
  const runCommand = (command: InsertCommand) => {
    if (command.disabled) return;
    command.run();
    if (command.closeAfterRun) onClose(command.id !== "context-open-inspector");
  };

  return createPortal(
    <div
      className="galgame-block-command-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose(true);
      }}
    >
      <section
        className="galgame-block-command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={placement}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          focusCommand(event.key === "ArrowDown" ? 1 : -1);
        }}
      >
        <h2 id={titleId} className="galgame-block-command-title">
          插入 Block
        </h2>
        <header>
          <label>
            <Search aria-hidden />
            <input
              ref={inputRef}
              aria-label="搜索可插入 Block"
              placeholder="搜索指令、设置、角色、文本、演出或逻辑…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !enabledCommands[0]) return;
                event.preventDefault();
                runCommand(enabledCommands[0]);
              }}
            />
            <kbd>Esc</kbd>
          </label>
          <button
            type="button"
            aria-label="关闭 Block 插入面板"
            onClick={() => onClose(true)}
          >
            <X aria-hidden />
          </button>
        </header>
        <div className="galgame-block-command-copy">
          <small>指令说明</small>
          <span>
            <strong>{activeCommand?.label ?? "插入 Block"}</strong>
            <em>
              {activeCommand?.description ??
                "选择一个 Block 类型插入当前剧情位置。"}
            </em>
          </span>
        </div>
        {visibleCommands.length ? (
          <div
            className={`galgame-block-command-groups${selectedBlock ? " has-context" : ""}`}
          >
            {selectedBlock ? (
              <section className="galgame-block-command-context">
                <strong>{BLOCK_LABELS[selectedBlock.type]}设置</strong>
                <div>
                  {filteredContextSections.map((section) => (
                    <div
                      className="galgame-block-command-context-section"
                      key={section.label}
                    >
                      <small>{section.label}</small>
                      <div>
                        {section.commands.map((command) => (
                          <button
                            ref={(element) => {
                              if (element)
                                commandRefs.current.set(command.id, element);
                              else commandRefs.current.delete(command.id);
                            }}
                            key={command.id}
                            type="button"
                            disabled={command.disabled}
                            className={command.checked ? "checked" : ""}
                            aria-pressed={command.checked}
                            onFocus={() => setActiveCommandId(command.id)}
                            onMouseEnter={() => setActiveCommandId(command.id)}
                            onClick={() => runCommand(command)}
                          >
                            <span>{command.icon}</span>
                            <b>{command.label}</b>
                            {command.checked ? <Check aria-hidden /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {INSERT_GROUPS.map((group) => {
              const groupCommands = filteredCommands.filter(
                (command) => command.group === group,
              );
              if (!groupCommands.length) return null;
              return (
                <section key={group}>
                  <strong>{group}</strong>
                  <div>
                    {groupCommands.map((command) => (
                      <button
                        ref={(element) => {
                          if (element)
                            commandRefs.current.set(command.id, element);
                          else commandRefs.current.delete(command.id);
                        }}
                        key={command.id}
                        type="button"
                        disabled={command.disabled}
                        onFocus={() => setActiveCommandId(command.id)}
                        onMouseEnter={() => setActiveCommandId(command.id)}
                        onClick={() => runCommand(command)}
                      >
                        <span>{command.icon}</span>
                        <b>{command.label}</b>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="galgame-block-command-empty">没有找到匹配的指令。</p>
        )}
      </section>
    </div>,
    document.body,
  );
}

function AttachedCharacterSummary({
  bundle,
  document,
}: {
  bundle: StoryBlockBundle;
  document: GalgameStoryProject;
}) {
  if (!bundle.attachedCharacterBlocks.length) return null;
  return (
    <span className="galgame-dialogue-attached-events">
      {bundle.attachedCharacterBlocks.map((block) => {
        const name =
          block.type === "removeCharacter" && block.all
            ? "全部角色"
            : ((document.characters ?? []).find(
                (character) => character.id === block.characterId,
              )?.name ?? "角色");
        return (
          <em key={block.id}>
            {block.type === "showCharacter" ? `${name}登场` : `${name}退场`}
          </em>
        );
      })}
    </span>
  );
}

function DialogueCard({
  block,
  bundle,
  index,
  selected,
  groupedBefore,
  groupedAfter,
  document,
  onSelect,
  onBlock,
  onContinue,
  onDelete,
  onVoiceStale,
}: {
  block: GalgameStoryDialogueBlock;
  bundle: StoryBlockBundle;
  index: number;
  selected: boolean;
  groupedBefore: boolean;
  groupedAfter: boolean;
  document: GalgameStoryProject;
  onSelect: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
  onContinue: (block: GalgameStoryDialogueBlock) => void;
  onDelete: () => void;
  onVoiceStale: () => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);
  const character = (document.characters ?? []).find(
    (candidate) => candidate.id === block.characterId,
  );
  const variables = Object.fromEntries(
    (document.variables ?? []).map((variable) => [
      variable.id,
      variable.defaultValue,
    ]),
  );
  const expressionAssetId = characterExpressionAssetId(
    character,
    block.expressionId,
    block.portrait?.skinId,
  );
  const expressionFileId = (document.assets ?? []).find(
    (asset) => asset.id === expressionAssetId,
  )?.fileId;
  return (
    <article
      className={`galgame-block-card galgame-dialogue-card is-dialogue${selected ? " selected" : ""}${editing ? " is-editing" : ""}${groupedBefore ? " is-grouped-before" : ""}${groupedAfter ? " is-grouped-after" : ""}`}
      data-block-id={block.id}
      style={
        {
          "--dialogue-theme": character?.themeColor ?? "#E75B55",
        } as CSSProperties
      }
      onClick={onSelect}
      onFocusCapture={onSelect}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.currentTarget === event.target) {
          event.preventDefault();
          setEditing(true);
        }
      }}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <div className="galgame-dialogue-card-body">
        {!groupedBefore ? (
          <header className="galgame-dialogue-summary">
            <span className="galgame-dialogue-avatar">
              <StoryAssetImage
                fileId={expressionFileId}
                alt=""
                fallback={
                  <b aria-hidden>
                    {character?.name.trim().slice(0, 1) || "角"}
                  </b>
                }
              />
            </span>
            <strong>
              {dialogueDisplayName(character, block.displayNameId, variables)}
            </strong>
            {block.portrait ? (
              <button
                type="button"
                className="galgame-dialogue-visibility"
                aria-label={
                  block.portrait.visible === false ? "显示立绘" : "隐藏立绘"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onBlock({
                    ...block,
                    portrait: {
                      ...block.portrait!,
                      visible: block.portrait!.visible === false,
                    },
                  });
                }}
              >
                {block.portrait.visible === false ? <EyeOff /> : <Eye />}
              </button>
            ) : null}
            {block.startMs != null && block.endMs != null ? (
              <time>
                <Clock3 aria-hidden /> {formatTimecode(block.startMs)}–
                {formatTimecode(block.endMs)}
              </time>
            ) : null}
            <AttachedCharacterSummary bundle={bundle} document={document} />
          </header>
        ) : null}
        <div className="galgame-dialogue-content-line">
          {groupedBefore ? (
            <span className="galgame-dialogue-group-dot" aria-hidden />
          ) : null}
          {block.expressionId ? (
            <em className="galgame-dialogue-expression">
              {(character?.expressions ?? []).find(
                (expression) => expression.id === block.expressionId,
              )?.label ?? "默认表情"}
            </em>
          ) : null}
          {!editing ? (
            <b>
              {block.text || block.content ? (
                <RichTextView
                  content={richTextDocument(block)}
                  document={document}
                  variables={variables}
                  editorMarks
                />
              ) : (
                "双击输入对白"
              )}
            </b>
          ) : (
            <RichTextEditor
              ariaLabel={`${character?.name ?? "角色"} 对白正文`}
              value={block.content ?? plainRichText(block.text)}
              document={document}
              character={character}
              placeholder="写下对白…"
              onPlainTextChange={() => block.voiceAssetId && onVoiceStale()}
              onChange={(content) =>
                onBlock({ ...block, content, text: richTextPlainText(content) })
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(false);
                  return;
                }
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                if (
                  !richTextPlainText(
                    block.content ?? plainRichText(block.text),
                  ).trim()
                )
                  onDelete();
                else onContinue(block);
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function NarrationCard({
  block,
  index,
  selected,
  document,
  onSelect,
  onBlock,
}: {
  block: Extract<GalgameStoryBlock, { type: "narration" }>;
  index: number;
  selected: boolean;
  document: GalgameStoryProject;
  onSelect: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);
  return (
    <article
      className={`galgame-block-card galgame-narration-card is-narration${selected ? " selected" : ""}${editing ? " is-editing" : ""}`}
      data-block-id={block.id}
      onClick={onSelect}
      onFocusCapture={onSelect}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.currentTarget === event.target) {
          event.preventDefault();
          setEditing(true);
        }
      }}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <header>
        <span className="galgame-block-kind">{blockIcon(block.type)}</span>
        <strong>旁白</strong>
        {!editing ? (
          <b>
            {block.text || block.content ? (
              <RichTextView
                content={richTextDocument(block)}
                document={document}
                editorMarks
              />
            ) : (
              "双击输入旁白"
            )}
          </b>
        ) : null}
        {block.startMs != null && block.endMs != null ? (
          <time>
            <Clock3 aria-hidden /> {formatTimecode(block.startMs)}–
            {formatTimecode(block.endMs)}
          </time>
        ) : null}
      </header>
      {editing ? (
        <RichTextEditor
          ariaLabel="旁白正文"
          value={block.content ?? plainRichText(block.text)}
          document={document}
          placeholder="写下旁白…"
          onChange={(content) => {
            const text = richTextPlainText(content);
            if (!block.text && text.startsWith("#")) {
              onBlock({
                id: block.id,
                type: "comment",
                text: text.slice(1).trimStart(),
              });
              return;
            }
            onBlock({ ...block, content, text });
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && !block.text.trim()) {
              event.preventDefault();
              setCommandOpen(true);
              return;
            }
            if (event.key !== "Escape") return;
            event.preventDefault();
            setEditing(false);
          }}
        />
      ) : null}
      {commandOpen ? (
        <div className="galgame-narration-command" role="menu">
          <strong>转换为角色对白</strong>
          {(document.characters ?? []).map((character) => (
            <button
              key={character.id}
              type="button"
              onClick={() => {
                onBlock({
                  id: block.id,
                  type: "dialogue",
                  characterId: character.id,
                  expressionId: character.defaultExpressionId ?? null,
                  text: block.text,
                  content: block.content,
                  voiceVolume: 100,
                  hideDialogueAfter: false,
                });
                setCommandOpen(false);
              }}
            >
              {character.name}
            </button>
          ))}
          <button type="button" onClick={() => setCommandOpen(false)}>
            取消
          </button>
        </div>
      ) : null}
    </article>
  );
}

function StoryParagraphCard({
  block,
  index,
  selected,
  groupedBefore,
  groupedAfter,
  document,
  onSelect,
  onBlock,
}: {
  block: Extract<GalgameStoryBlock, { type: "storyParagraph" }>;
  index: number;
  selected: boolean;
  groupedBefore: boolean;
  groupedAfter: boolean;
  document: GalgameStoryProject;
  onSelect: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);
  return (
    <article
      className={`galgame-block-card galgame-paragraph-card is-storyParagraph${selected ? " selected" : ""}${editing ? " is-editing" : ""}${groupedBefore ? " is-grouped-before" : ""}${groupedAfter ? " is-grouped-after" : ""}`}
      data-block-id={block.id}
      onClick={onSelect}
      onFocusCapture={onSelect}
      onDoubleClick={() => setEditing(true)}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <header>
        <span className="galgame-block-kind">{blockIcon(block.type)}</span>
        <strong>{groupedBefore ? "继续段落" : "剧情段落"}</strong>
        {!editing ? (
          <b>
            {block.text || block.content ? (
              <RichTextView
                content={richTextDocument(block)}
                document={document}
                editorMarks
              />
            ) : (
              "双击输入段落"
            )}
          </b>
        ) : null}
        {block.textSpeedCps ? <em>{block.textSpeedCps} 字/秒</em> : null}
      </header>
      {editing ? (
        <RichTextEditor
          ariaLabel="剧情段落正文"
          value={block.content ?? plainRichText(block.text)}
          document={document}
          placeholder="写下全屏剧情段落…"
          onChange={(content) =>
            onBlock({ ...block, content, text: richTextPlainText(content) })
          }
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setEditing(false);
          }}
        />
      ) : null}
    </article>
  );
}

function CommentCard({
  block,
  index,
  selected,
  onSelect,
  onBlock,
}: {
  block: Extract<GalgameStoryBlock, { type: "comment" }>;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
}) {
  return (
    <article
      className={`galgame-block-card galgame-comment-card is-comment${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onClick={onSelect}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <span aria-hidden>#</span>
      <input
        aria-label="作者注释"
        value={block.text}
        placeholder="这条注释不会进入游戏"
        onChange={(event) => onBlock({ ...block, text: event.target.value })}
      />
    </article>
  );
}

function waitDurationLabel(durationMs: number | null) {
  if (durationMs == null) return "等待玩家继续";
  const seconds = durationMs / 1000;
  return `≈ ${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
}

function CurtainSwatch({
  mode,
  color,
}: {
  mode: Extract<GalgameStoryBlock, { type: "curtain" }>["mode"];
  color: string;
}) {
  return (
    <span
      className={`galgame-curtain-swatch is-${mode}`}
      style={{ "--curtain-card-color": color } as CSSProperties}
      aria-hidden
    >
      <i className="is-fullscreen" />
      <i className="is-top" />
      <i className="is-bottom" />
      <i className="is-left" />
      <i className="is-right" />
    </span>
  );
}

function CurtainCard({
  block,
  index,
  selected,
  onSelect,
}: {
  block: Extract<GalgameStoryBlock, { type: "curtain" }>;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const modeLabel =
    CURTAIN_MODE_OPTIONS.find((option) => option.value === block.mode)?.label ??
    "全屏";
  return (
    <article
      className={`galgame-block-card galgame-curtain-card is-curtain${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <button
        type="button"
        className="galgame-block-select"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="galgame-curtain-badge">
          {blockIcon(block.type)}
          <strong>幕布</strong>
        </span>
        <CurtainSwatch mode={block.mode} color={block.color} />
        <span className="galgame-curtain-copy">
          <b>{block.action === "show" ? "合上" : "打开"}</b>
          <em>{block.action === "show" ? "渐入幕布" : "渐出幕布"}</em>
        </span>
        <span className="galgame-curtain-meta">
          <small>{(block.durationMs / 1000).toFixed(1)}s</small>
          <small>{modeLabel}</small>
          <i style={{ backgroundColor: block.color }} aria-hidden />
        </span>
      </button>
    </article>
  );
}

function WaitCard({
  block,
  index,
  selected,
  onSelect,
  onBlock,
}: {
  block: Extract<GalgameStoryBlock, { type: "wait" }>;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
}) {
  return (
    <article
      className={`galgame-block-card galgame-wait-card is-wait${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onClick={onSelect}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <span className="galgame-wait-badge">
        {blockIcon(block.type)}
        <strong>等待</strong>
      </span>
      <label className="galgame-wait-duration">
        <input
          aria-label="等待时长"
          type="number"
          min="0"
          max="3600000"
          disabled={block.mode === "player"}
          value={block.durationMs ?? ""}
          onChange={(event) =>
            onBlock({
              ...block,
              mode: "duration",
              durationMs: Math.min(
                3600000,
                Math.max(0, Number(event.target.value)),
              ),
            })
          }
        />
        <span>ms</span>
      </label>
      <span className="galgame-wait-card-presets" aria-label="等待预设">
        {WAIT_DURATION_PRESETS.map((durationMs) => (
          <button
            key={durationMs}
            type="button"
            className={
              block.mode === "duration" && block.durationMs === durationMs
                ? "active"
                : ""
            }
            aria-pressed={
              block.mode === "duration" && block.durationMs === durationMs
            }
            onClick={() => onBlock({ ...block, mode: "duration", durationMs })}
          >
            {durationMs}
          </button>
        ))}
        <button
          type="button"
          className={block.mode === "player" ? "active" : ""}
          aria-pressed={block.mode === "player"}
          onClick={() =>
            onBlock({ ...block, mode: "player", durationMs: null })
          }
        >
          等待玩家继续
        </button>
      </span>
      <em className="galgame-wait-summary">
        {waitDurationLabel(block.durationMs)}
      </em>
    </article>
  );
}

function OfficialCommandCard({
  block,
  index,
  selected,
  onSelect,
}: {
  block: Extract<
    GalgameStoryBlock,
    { type: "paragraphParams" | "systemMessage" }
  >;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const summary =
    block.type === "systemMessage"
      ? `${block.mode === "confirm" ? "确认" : "提示"} · ${block.text || "未填写消息"}`
      : [
          block.textSpeedCps != null ? `${block.textSpeedCps} 字/秒` : "",
          block.revealEffect ?? "",
          block.readBehavior ?? "",
        ]
          .filter(Boolean)
          .join(" · ") || "调整后续段落";
  return (
    <article
      className={`galgame-block-card galgame-official-command is-${block.type}${selected ? " selected" : ""}`}
      data-block-id={block.id}
      onFocusCapture={onSelect}
      tabIndex={0}
    >
      <span className="galgame-block-index">{index + 1}</span>
      <button type="button" className="galgame-block-select" onClick={onSelect}>
        <span className="galgame-block-kind">{blockIcon(block.type)}</span>
        <span className="galgame-block-copy">
          <strong>{BLOCK_LABELS[block.type]}</strong>
          <b>{summary}</b>
        </span>
      </button>
    </article>
  );
}

export function StoryBlockEditor({
  document,
  chapter,
  fragment,
  selectedBlockId,
  onSelectBlock,
  onEditProperties,
  onBlock,
  onAddBlock,
  onAddAllCharacters,
  onAddAudio,
  onContinueDialogue,
  onDeleteBlock,
  onVoiceStale,
}: {
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  fragment: GalgameStoryFragment;
  selectedBlockId?: string;
  onSelectBlock: (blockId: string) => void;
  onEditProperties: () => void;
  onBlock: (block: GalgameStoryBlock) => void;
  onAddBlock: (kind: BlockKind, beforeBundleId?: string) => void;
  onAddAllCharacters: (beforeBundleId?: string) => void;
  onAddAudio: (
    action: "play" | "stop",
    channel: AudioChannel,
    beforeBundleId?: string,
  ) => void;
  onContinueDialogue: (
    block: GalgameStoryDialogueBlock,
    beforeBundleId?: string,
  ) => void;
  onDeleteBlock: (blockId: string) => void;
  onVoiceStale: (blockId: string) => void;
}) {
  const editorRef = useRef<HTMLElement>(null);
  const insertTargetRef = useRef<{
    anchor: HTMLElement;
    beforeBundleId?: string;
  } | null>(null);
  const focusInsertedBlockRef = useRef(false);
  const focusInsertedBlockTimeoutRef = useRef<number | undefined>(undefined);
  const [insertTarget, setInsertTarget] = useState<{
    anchor: HTMLElement;
    beforeBundleId?: string;
  } | null>(null);
  const bundles = storyBlockBundles(fragment);
  const hasTerminator = bundles.some(
    (bundle) =>
      bundle.primaryBlock.type === "branch" ||
      bundle.primaryBlock.type === "endChapter",
  );
  const selectedBundle = bundles.find((bundle) =>
    bundle.blocks.some((block) => block.id === selectedBlockId),
  );
  const openInsertPalette = (anchor: HTMLElement, beforeBundleId?: string) => {
    const target = { anchor, beforeBundleId };
    insertTargetRef.current = target;
    setInsertTarget(target);
  };
  const closeInsertPalette = useCallback((restoreFocus: boolean) => {
    const target = insertTargetRef.current;
    insertTargetRef.current = null;
    setInsertTarget(null);
    if (restoreFocus)
      requestAnimationFrame(() => {
        if (target?.anchor.isConnected) target.anchor.focus();
      });
  }, []);
  const expectInsertedBlockFocus = () => {
    focusInsertedBlockRef.current = true;
    if (focusInsertedBlockTimeoutRef.current)
      window.clearTimeout(focusInsertedBlockTimeoutRef.current);
    focusInsertedBlockTimeoutRef.current = window.setTimeout(() => {
      focusInsertedBlockRef.current = false;
      focusInsertedBlockTimeoutRef.current = undefined;
    }, 500);
  };

  useEffect(() => {
    if (!focusInsertedBlockRef.current || !selectedBlockId) return;
    focusInsertedBlockRef.current = false;
    if (focusInsertedBlockTimeoutRef.current) {
      window.clearTimeout(focusInsertedBlockTimeoutRef.current);
      focusInsertedBlockTimeoutRef.current = undefined;
    }
    requestAnimationFrame(() => {
      const card = editorRef.current?.querySelector<HTMLElement>(
        `[data-block-id="${selectedBlockId}"]`,
      );
      card?.focus();
    });
  }, [selectedBlockId]);

  useEffect(
    () => () => {
      if (focusInsertedBlockTimeoutRef.current)
        window.clearTimeout(focusInsertedBlockTimeoutRef.current);
    },
    [],
  );

  return (
    <section
      ref={editorRef}
      className="galgame-story-block-editor"
      aria-label="Block 卡片编辑器"
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "button, input, textarea, select, a, [contenteditable='true']",
          )
        )
          return;
        target.closest<HTMLElement>("[data-block-id]")?.focus();
      }}
      onKeyDownCapture={(event) => {
        if (
          event.key !== "Tab" ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.nativeEvent.isComposing ||
          insertTarget
        )
          return;
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "input, textarea, select, [contenteditable='true'], [role='dialog']",
          )
        )
          return;
        if (!bundles.length) {
          const empty = target.closest<HTMLElement>(".galgame-empty-blocks");
          if (!empty) return;
          event.preventDefault();
          openInsertPalette(empty);
          return;
        }
        if (!selectedBundle) return;
        const selectedCard = editorRef.current?.querySelector<HTMLElement>(
          `[data-block-id="${selectedBundle.id}"]`,
        );
        if (!selectedCard?.contains(target)) return;
        event.preventDefault();
        openInsertPalette(selectedCard, selectedBundle.id);
      }}
    >
      <div className="galgame-block-list">
        {bundles.map((bundle, index) => {
          const block = bundle.primaryBlock;
          const nextBundleId = bundles[index + 1]?.id;
          const selected = bundle.blocks.some(
            (candidate) => candidate.id === selectedBlockId,
          );
          return (
            <div className="galgame-block-row" key={bundle.id}>
              {block.type === "dialogue" ? (
                <DialogueCard
                  block={block}
                  bundle={bundle}
                  index={index}
                  selected={selected}
                  groupedBefore={sameDialogueGroup(
                    bundles[index - 1]?.primaryBlock,
                    block,
                  )}
                  groupedAfter={sameDialogueGroup(
                    block,
                    bundles[index + 1]?.primaryBlock,
                  )}
                  document={document}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                  onContinue={(current) =>
                    onContinueDialogue(current, nextBundleId)
                  }
                  onDelete={() => {
                    onDeleteBlock(block.id);
                    requestAnimationFrame(() => {
                      const focusId =
                        nextBundleId ?? bundles[index - 1]?.primaryBlock.id;
                      if (!focusId) return;
                      editorRef.current
                        ?.querySelector<HTMLElement>(
                          `[data-block-id="${focusId}"]`,
                        )
                        ?.focus();
                    });
                  }}
                  onVoiceStale={() => onVoiceStale(block.id)}
                />
              ) : block.type === "narration" ? (
                <NarrationCard
                  block={block}
                  index={index}
                  selected={selected}
                  document={document}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "storyParagraph" ? (
                <StoryParagraphCard
                  block={block}
                  index={index}
                  selected={selected}
                  groupedBefore={
                    bundles[index - 1]?.primaryBlock.type === "storyParagraph"
                  }
                  groupedAfter={
                    bundles[index + 1]?.primaryBlock.type === "storyParagraph"
                  }
                  document={document}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "comment" ? (
                <CommentCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "wait" ? (
                <WaitCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                  onBlock={onBlock}
                />
              ) : block.type === "curtain" ? (
                <CurtainCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                />
              ) : block.type === "paragraphParams" ||
                block.type === "systemMessage" ? (
                <OfficialCommandCard
                  block={block}
                  index={index}
                  selected={selected}
                  onSelect={() => onSelectBlock(block.id)}
                />
              ) : (
                <article
                  className={`galgame-block-card is-${block.type}${selected ? " selected" : ""}`}
                  data-block-id={block.id}
                  onFocusCapture={() => onSelectBlock(block.id)}
                  tabIndex={0}
                >
                  <span className="galgame-block-index">{index + 1}</span>
                  <button
                    type="button"
                    className="galgame-block-select"
                    aria-pressed={selected}
                    onClick={() => onSelectBlock(block.id)}
                  >
                    {block.type === "scene" || block.type === "showCg" ? (
                      <span className="galgame-block-thumbnail">
                        <StoryAssetImage
                          fileId={blockPreviewFileId(block, document)}
                          alt=""
                          fallback={blockIcon(block.type)}
                        />
                      </span>
                    ) : null}
                    <span className="galgame-block-kind">
                      {blockIcon(block.type)}
                    </span>
                    <span className="galgame-block-copy">
                      <span>
                        <strong>{BLOCK_LABELS[block.type]}</strong>
                        {"atMs" in block && block.atMs != null ? (
                          <em>独立 · {formatTimecode(block.atMs)}</em>
                        ) : null}
                      </span>
                      <b>{blockSummary(block, document, chapter)}</b>
                    </span>
                    {block.type === "audio" ? (
                      <Volume2 aria-hidden />
                    ) : (
                      blockIcon(block.type)
                    )}
                  </button>
                </article>
              )}
            </div>
          );
        })}
        {!bundles.length ? (
          <div className="galgame-empty-blocks" tabIndex={0}>
            <MessageSquareText aria-hidden />
            <strong>这个 Fragment 还没有 Block</strong>
            <span>按 Tab 或使用下方按钮添加第一个 Block。</span>
            <button
              type="button"
              onClick={(event) => openInsertPalette(event.currentTarget)}
            >
              <Plus aria-hidden />
              添加第一个 Block
            </button>
          </div>
        ) : null}
      </div>
      <footer>
        <span>{bundles.length} 个可见 Block</span>
        <span>选中 Block，按 Tab 在其前面插入</span>
      </footer>
      {insertTarget ? (
        <BlockInsertPalette
          anchor={insertTarget.anchor}
          beforeBundleId={insertTarget.beforeBundleId}
          selectedBlock={selectedBundle?.primaryBlock}
          story={document}
          hasTerminator={hasTerminator}
          onClose={closeInsertPalette}
          onBlock={onBlock}
          onEditProperties={onEditProperties}
          onAddBlock={(kind, beforeBundleId) => {
            expectInsertedBlockFocus();
            onAddBlock(kind, beforeBundleId);
          }}
          onAddAllCharacters={(beforeBundleId) => {
            expectInsertedBlockFocus();
            onAddAllCharacters(beforeBundleId);
          }}
          onAddAudio={(action, channel, beforeBundleId) => {
            expectInsertedBlockFocus();
            onAddAudio(action, channel, beforeBundleId);
          }}
        />
      ) : null}
    </section>
  );
}
