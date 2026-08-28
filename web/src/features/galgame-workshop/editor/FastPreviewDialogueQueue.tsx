import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";

type DialogueQueueItem = {
  block: GalgameStoryBlock;
  blockIndex: number;
  text: string;
};

export function FastPreviewDialogueQueue({
  document,
  queue,
  onPrevious,
  onPlay,
  onNext,
}: {
  document: GalgameStoryProject;
  queue: {
    previous?: DialogueQueueItem;
    current?: DialogueQueueItem;
    next?: DialogueQueueItem;
  };
  onPrevious: () => void;
  onPlay: () => void;
  onNext: () => void;
}) {
  return (
    <aside className="galgame-preview-dialogue-queue">
      <header>
        <span>
          <strong>对白导航</strong>
          <small>当前附近 3 句</small>
        </span>
      </header>
      <div>
        {(["previous", "current", "next"] as const).map((position) => {
          const item = queue[position];
          const dialogue =
            item?.block.type === "dialogue" ? item.block : undefined;
          const character = dialogue
            ? document.characters?.find(
                (candidate) => candidate.id === dialogue.characterId,
              )
            : undefined;
          const speaker = character?.name ?? "旁白";
          return (
            <article key={position} className={`is-${position}`}>
              <small>
                {position === "previous"
                  ? "上一句"
                  : position === "current"
                    ? "当前对白"
                    : "下一句"}
              </small>
              <strong>
                <i aria-hidden>{speaker.slice(0, 1)}</i>
                {speaker}
              </strong>
              <p>{item?.text ?? "—"}</p>
            </article>
          );
        })}
      </div>
      <nav aria-label="对白导航快捷操作">
        <button
          type="button"
          aria-label="从侧栏切换到上一对白"
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden />
          上一句
        </button>
        <button type="button" aria-label="从侧栏播放预览" onClick={onPlay}>
          <Play aria-hidden />
          播放
        </button>
        <button
          type="button"
          aria-label="从侧栏切换到下一对白"
          onClick={onNext}
        >
          下一句
          <ChevronRight aria-hidden />
        </button>
      </nav>
    </aside>
  );
}
