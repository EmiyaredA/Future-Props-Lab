import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BookOpenText, Clock3, Settings2 } from "lucide-react";
import type {
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";
import { characterExpressionAssetId } from "@features/galgame-workshop/editor/richText";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="galgame-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function InlineEditableName({
  value,
  label,
  onCommit,
  onEmpty,
  maxLength = 120,
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  onEmpty?: () => void;
  maxLength?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const commit = () => {
    const nextValue = draft.trim();
    if (!nextValue) {
      onEmpty?.();
      cancel();
      return;
    }
    if (nextValue !== value) onCommit(nextValue);
    setEditing(false);
  };

  return (
    <strong className="galgame-inline-editable-name">
      {editing ? (
        <input
          ref={inputRef}
          aria-label={`编辑${label}`}
          value={draft}
          maxLength={maxLength}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={`双击编辑${label}：${value}`}
          title={`双击编辑${label}`}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              setEditing(true);
            }
          }}
        >
          {value}
        </button>
      )}
    </strong>
  );
}

export function ChapterCast({
  document,
  chapter,
}: {
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
}) {
  const characterIds = Array.from(
    new Set(
      (chapter.fragments ?? []).flatMap((fragment) =>
        (fragment.blocks ?? []).flatMap((block) => {
          if (
            block.type === "dialogue" ||
            block.type === "showCharacter" ||
            (block.type === "removeCharacter" && !block.all)
          )
            return block.characterId ? [block.characterId] : [];
          return [];
        }),
      ),
    ),
  ).slice(0, 3);
  if (!characterIds.length) return null;
  return (
    <span className="galgame-chapter-cast" aria-label="章节角色">
      {characterIds.map((characterId) => {
        const character = (document.characters ?? []).find(
          (candidate) => candidate.id === characterId,
        );
        const portraitAssetId = characterExpressionAssetId(
          character,
          character?.defaultExpressionId,
          undefined,
        );
        const asset = document.assets?.find(
          (candidate) => candidate.id === portraitAssetId,
        );
        return (
          <span
            key={characterId}
            title={character?.name}
            style={
              { "--chapter-cast-color": character?.themeColor } as CSSProperties
            }
          >
            <StoryAssetImage
              fileId={asset?.fileId}
              alt=""
              fallback={<b>{character?.name.slice(0, 1) ?? "角"}</b>}
            />
          </span>
        );
      })}
    </span>
  );
}

export function FragmentOverviewInspector({
  fragment,
  durationMs,
  isEntry,
  estimated,
}: {
  fragment: GalgameStoryFragment;
  durationMs: number;
  isEntry: boolean;
  estimated: boolean;
}) {
  return (
    <div className="galgame-fragment-overview">
      <header>
        <span>
          <small>FRAGMENT</small>
          <strong>{fragment.title}</strong>
        </span>
        {isEntry ? <em>入口</em> : null}
      </header>
      <div className="galgame-fragment-overview-metrics">
        <span>
          <Clock3 aria-hidden />
          <small>{estimated ? "估算时长" : "剧情时长"}</small>
          <strong>{formatTimecode(durationMs)}</strong>
        </span>
        <span>
          <BookOpenText aria-hidden />
          <small>Block 数量</small>
          <strong>{fragment.blocks?.length ?? 0}</strong>
        </span>
      </div>
      <footer>
        <Settings2 aria-hidden />
        <span>
          <strong>选择时间轴内容项以编辑</strong>
          <small>可以直接选择对白、舞台、声音或无对白区间。</small>
        </span>
      </footer>
    </div>
  );
}
