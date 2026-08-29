import {
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Check, Music2, Search, Settings2, Volume2, X } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  AUDIO_LABELS,
  BLOCK_LABELS,
  blockIcon,
  contextSettingIcon,
  type AudioChannel,
} from "@features/galgame-workshop/editor/story-authoring/blockPresentation";
import type { BlockKind } from "@features/galgame-workshop/editor/model";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
import { blockContextSettings } from "@features/galgame-workshop/editor/blockContextSettings";

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

export function BlockInsertPalette({
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
