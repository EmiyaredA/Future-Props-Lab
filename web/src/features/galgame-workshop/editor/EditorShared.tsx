import type { CSSProperties, ReactNode } from "react";
import { BookOpenText, Clock3, Settings2 } from "lucide-react";
import type {
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";

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
