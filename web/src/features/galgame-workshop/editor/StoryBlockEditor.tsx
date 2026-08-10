import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Clock3,
  Eye,
  EyeOff,
  Flag,
  GitBranch,
  Images,
  MapPinned,
  MessageSquareText,
  Music2,
  Plus,
  UserRound,
  Volume2,
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
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
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

function blockIcon(type: BlockKind) {
  if (type === "scene") return <MapPinned aria-hidden />;
  if (type === "showCg" || type === "hideCg") return <Images aria-hidden />;
  if (type === "dialogue") return <UserRound aria-hidden />;
  if (type === "showCharacter" || type === "removeCharacter")
    return <UserRound aria-hidden />;
  if (type === "audio") return <Music2 aria-hidden />;
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

function BlockInsertMenu({
  beforeBundleId,
  hasTerminator,
  onAddBlock,
  onAddAllCharacters,
  onAddAudio,
}: {
  beforeBundleId?: string;
  hasTerminator: boolean;
  onAddBlock: (kind: BlockKind, beforeBundleId?: string) => void;
  onAddAllCharacters: (beforeBundleId?: string) => void;
  onAddAudio: (
    action: "play" | "stop",
    channel: AudioChannel,
    beforeBundleId?: string,
  ) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const closeThen = (action: () => void) => {
    action();
    if (detailsRef.current) detailsRef.current.open = false;
  };
  const openWithKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    if (!detailsRef.current) return;
    detailsRef.current.open = true;
    requestAnimationFrame(() =>
      detailsRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
  };
  const buttons = (kinds: BlockKind[]) =>
    kinds
      .filter((kind) =>
        BLOCK_LABELS[kind]
          .toLocaleLowerCase("zh-CN")
          .includes(query.trim().toLocaleLowerCase("zh-CN")),
      )
      .map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={
            hasTerminator && (kind === "endChapter" || kind === "returnToEntry")
          }
          onClick={() => closeThen(() => onAddBlock(kind, beforeBundleId))}
        >
          {BLOCK_LABELS[kind]}
        </button>
      ));
  return (
    <details
      ref={detailsRef}
      className="galgame-block-insert"
      data-insertion-id={beforeBundleId ?? "end"}
    >
      <summary
        role="button"
        aria-label="在这里插入 Block"
        onKeyDown={openWithKeyboard}
      >
        <span />
        <Plus aria-hidden />
        <em>插入 Block</em>
        <span />
      </summary>
      <div className="galgame-block-insert-menu" aria-label="可插入 Block">
        <input
          aria-label="搜索 Block"
          placeholder="搜索角色、文本、演出或逻辑…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <section>
          <strong>角色</strong>
          <div>
            {buttons([
              "dialogue",
              "showCharacter",
              "removeCharacter",
              "animateSprite",
              "portraitStyleRule",
            ])}
            <button
              type="button"
              onClick={() =>
                closeThen(() => onAddAllCharacters(beforeBundleId))
              }
            >
              全部退场
            </button>
          </div>
        </section>
        <section>
          <strong>文本</strong>
          <div>
            {buttons([
              "narration",
              "storyParagraph",
              "paragraphParams",
              "systemMessage",
              "comment",
              "wait",
            ])}
          </div>
        </section>
        <section>
          <strong>演出</strong>
          <div>
            {buttons([
              "scene",
              "destroyScene",
              "showCg",
              "hideCg",
              "camera",
              "resetCamera",
              "particle",
              "stageAnimation",
              "floatingText",
              "curtain",
              "video",
              "autoPlay",
              "switchDialogueStyle",
            ])}
          </div>
        </section>
        <section>
          <strong>声音</strong>
          <div>
            {(Object.keys(AUDIO_LABELS) as AudioChannel[]).map((channel) => (
              <button
                key={`play-${channel}`}
                type="button"
                onClick={() =>
                  closeThen(() => onAddAudio("play", channel, beforeBundleId))
                }
              >
                {AUDIO_LABELS[channel]}
              </button>
            ))}
            {(Object.keys(AUDIO_LABELS) as AudioChannel[]).map((channel) => (
              <button
                key={`stop-${channel}`}
                type="button"
                onClick={() =>
                  closeThen(() => onAddAudio("stop", channel, beforeBundleId))
                }
              >
                停止{AUDIO_LABELS[channel]}
              </button>
            ))}
          </div>
        </section>
        <section>
          <strong>逻辑</strong>
          <div>
            {buttons([
              "branch",
              "if",
              "setVariable",
              "callFragment",
              "gallery",
              "endChapter",
              "returnToEntry",
            ])}
          </div>
        </section>
      </div>
    </details>
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
                fallback={blockIcon(block.type)}
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

function OfficialCommandCard({
  block,
  index,
  selected,
  onSelect,
}: {
  block: Extract<
    GalgameStoryBlock,
    { type: "paragraphParams" | "systemMessage" | "wait" }
  >;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const summary =
    block.type === "systemMessage"
      ? `${block.mode === "confirm" ? "确认" : "提示"} · ${block.text || "未填写消息"}`
      : block.type === "wait"
        ? block.mode === "player"
          ? "等待玩家继续"
          : `等待 ${block.durationMs ?? 0}ms`
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
  const bundles = storyBlockBundles(fragment);
  const hasTerminator = bundles.some(
    (bundle) =>
      bundle.primaryBlock.type === "branch" ||
      bundle.primaryBlock.type === "endChapter",
  );
  return (
    <section
      className="galgame-story-block-editor"
      aria-label="Block 卡片编辑器"
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
              <BlockInsertMenu
                beforeBundleId={bundle.id}
                hasTerminator={hasTerminator}
                onAddBlock={onAddBlock}
                onAddAllCharacters={onAddAllCharacters}
                onAddAudio={onAddAudio}
              />
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
                      const insertionId = nextBundleId ?? "end";
                      globalThis.document
                        .querySelector<HTMLElement>(
                          `[data-insertion-id="${insertionId}"] > summary`,
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
              ) : block.type === "paragraphParams" ||
                block.type === "systemMessage" ||
                block.type === "wait" ? (
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
          <div className="galgame-empty-blocks">
            <MessageSquareText aria-hidden />
            <strong>这个 Fragment 还没有 Block</strong>
            <span>从插入位置开始写旁白、对白或舞台演出。</span>
          </div>
        ) : null}
        {!hasTerminator ? (
          <BlockInsertMenu
            hasTerminator={false}
            onAddBlock={onAddBlock}
            onAddAllCharacters={onAddAllCharacters}
            onAddAudio={onAddAudio}
          />
        ) : null}
      </div>
      <footer>
        <span>{bundles.length} 个可见 Block</span>
        <span>插入位置按 Tab 打开菜单</span>
      </footer>
    </section>
  );
}
