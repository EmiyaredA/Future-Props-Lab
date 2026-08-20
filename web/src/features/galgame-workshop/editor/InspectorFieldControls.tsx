import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  BookOpenText,
  Clock3,
  Flag,
  GitBranch,
  Images,
  MapPinned,
  MessageSquareText,
  Music2,
  Settings2,
  UserRound,
} from "lucide-react";
import {
  type GalgameStoryChapter,
  type GalgameStoryCgTransition,
  type GalgameStoryFragment,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { BLOCK_REGISTRY } from "@features/galgame-workshop/editor/blockRegistry";
import { type BlockKind } from "@features/galgame-workshop/editor/model";
import {
  formatTimecode,
  parseTimecode,
} from "@features/galgame-workshop/editor/timeline";
import "@features/galgame-workshop/galgame-workshop.css";
import "@features/galgame-workshop/galgame-script-workbench.css";
import type { useBlockInspectorController } from "@features/galgame-workshop/editor/useBlockInspectorController";
export const BLOCK_LABELS = Object.fromEntries(
  Object.entries(BLOCK_REGISTRY).map(([type, capability]) => [
    type,
    capability.label,
  ]),
) as Record<BlockKind, string>;

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

export function CgTransitionFields({
  transition,
  onChange,
}: {
  transition?: GalgameStoryCgTransition;
  onChange: (transition: GalgameStoryCgTransition) => void;
}) {
  const value = { durationMs: 400, fade: true, ...transition };
  return (
    <div className="galgame-character-transition-fields">
      <label>
        <input
          type="checkbox"
          checked={value.fade}
          onChange={(event) =>
            onChange({ ...value, fade: event.target.checked })
          }
        />
        <span>CG 淡入淡出</span>
      </label>
      <label className="galgame-stage-range">
        <span>
          过渡时长 <em>{value.durationMs}ms</em>
        </span>
        <input
          aria-label="CG 过渡时长"
          type="range"
          min="0"
          max="5000"
          step="50"
          value={value.durationMs}
          onChange={(event) =>
            onChange({
              ...value,
              durationMs: Number(event.target.value),
            })
          }
        />
      </label>
    </div>
  );
}

export function TimecodeField({
  label,
  value,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (milliseconds: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(() => formatTimecode(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(formatTimecode(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseTimecode(draft);
    if (parsed == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(parsed);
  };

  return (
    <label className={`galgame-field${invalid ? " invalid" : ""}`}>
      <span>{label}</span>
      <input
        disabled={disabled}
        value={draft}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder="00:00.000"
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            setDraft(formatTimecode(value));
            setInvalid(false);
          }
        }}
      />
      {invalid ? <small>请输入 mm:ss.mmm 格式</small> : null}
    </label>
  );
}

export function BlockTypeIcon({ type }: { type: BlockKind }) {
  if (type === "scene") return <MapPinned aria-hidden />;
  if (type === "showCg" || type === "hideCg") return <Images aria-hidden />;
  if (
    type === "dialogue" ||
    type === "showCharacter" ||
    type === "removeCharacter"
  )
    return <UserRound aria-hidden />;
  if (type === "audio") return <Music2 aria-hidden />;
  if (type === "branch") return <GitBranch aria-hidden />;
  if (type === "endChapter") return <Flag aria-hidden />;
  return <MessageSquareText aria-hidden />;
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
        const expression = character?.expressions?.find(
          (candidate) => candidate.id === character.defaultExpressionId,
        );
        const asset = document.assets?.find(
          (candidate) => candidate.id === expression?.assetId,
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

export type BlockInspectorViewModel = ReturnType<
  typeof useBlockInspectorController
>;
