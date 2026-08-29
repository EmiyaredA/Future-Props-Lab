import { useEffect, useState, type CSSProperties } from "react";
import { Clock3, Eye, EyeOff } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { StoryBlockBundle } from "@features/galgame-workshop/editor/blockFlow";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import { blockIcon } from "@features/galgame-workshop/editor/story-authoring/blockPresentation";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import type { StageActor } from "@features/galgame-workshop/editor/stage";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
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
import { DialoguePresentationPicker } from "@features/galgame-workshop/editor/StoryBlockPresentationPicker";

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
        if (block.type === "setStageCast") {
          const names = (block.members ?? []).map(
            (member) =>
              (document.characters ?? []).find(
                (character) => character.id === member.characterId,
              )?.name ?? "角色",
          );
          return (
            <em key={block.id}>
              {names.length ? `构图 · ${names.join("、")}` : "清空角色"}
            </em>
          );
        }
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

export function DialogueCard({
  block,
  bundle,
  index,
  selected,
  groupedBefore,
  groupedAfter,
  document,
  effectiveActor,
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
  effectiveActor?: StageActor;
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
            <DialoguePresentationPicker
              block={block}
              document={document}
              effectiveActor={effectiveActor}
              onBlock={onBlock}
            />
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

export function NarrationCard({
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

export function StoryParagraphCard({
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
