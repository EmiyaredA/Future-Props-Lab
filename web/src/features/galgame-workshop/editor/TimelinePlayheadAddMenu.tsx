import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";
import type { BlockKind } from "@features/galgame-workshop/editor/model";
import { formatTimecode } from "@features/galgame-workshop/editor/timeline";

const BLOCK_LABELS: Partial<Record<BlockKind, string>> = {
  scene: "场景",
  showCg: "显示 CG",
  hideCg: "隐藏 CG",
  showCharacter: "角色登场 / 调整",
  removeCharacter: "角色退场",
  narration: "旁白",
  dialogue: "对白",
  branch: "分支",
  endChapter: "章节结局",
};

const AUDIO_LABELS = {
  bgm: "背景音乐",
  ambient: "环境音",
  sfx: "音效",
} as const;

export const TimelinePlayheadAddMenu = forwardRef<
  HTMLDetailsElement,
  {
    positionMs: number;
    hasTerminator: boolean;
    onAddBlock: (kind: BlockKind) => void;
    onAddAllCharacters: () => void;
    onAddAudio: (
      action: "play" | "stop",
      channel: keyof typeof AUDIO_LABELS,
    ) => void;
  }
>(function TimelinePlayheadAddMenu(
  { positionMs, hasTerminator, onAddBlock, onAddAllCharacters, onAddAudio },
  ref,
) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>();
  useImperativeHandle(ref, () => detailsRef.current!);

  const placePopover = useCallback(() => {
    const summary = summaryRef.current;
    if (!summary) return;
    const bounds = summary.getBoundingClientRect();
    const viewportPadding = 24;
    const width = Math.min(560, window.innerWidth - viewportPadding * 2);
    const left = Math.max(
      viewportPadding,
      Math.min(
        bounds.right - width,
        window.innerWidth - width - viewportPadding,
      ),
    );
    const top = bounds.bottom + 6;
    setPopoverStyle({
      top,
      left,
      width,
      maxHeight: Math.max(120, window.innerHeight - top - viewportPadding),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePopover();
  }, [open, placePopover]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => placePopover();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !detailsRef.current) return;
      detailsRef.current.open = false;
      setOpen(false);
      summaryRef.current?.focus();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, placePopover]);

  const closeMenu = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setOpen(false);
  };

  const runAndClose = (action: () => void) => {
    action();
    closeMenu();
  };

  const blockButtons = (kinds: BlockKind[]) =>
    kinds.map((kind) => (
      <button
        key={kind}
        type="button"
        disabled={hasTerminator && (kind === "branch" || kind === "endChapter")}
        onClick={() => runAndClose(() => onAddBlock(kind))}
      >
        {BLOCK_LABELS[kind]}
      </button>
    ));

  return (
    <details
      ref={detailsRef}
      className="galgame-playhead-add-menu"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={summaryRef} role="button" aria-label="在播放头添加内容">
        <Plus aria-hidden />
        <span>添加</span>
        <time>{formatTimecode(positionMs)}</time>
        <ChevronDown aria-hidden />
      </summary>
      {open && popoverStyle
        ? createPortal(
            <div
              className="galgame-playhead-add-popover"
              style={popoverStyle}
              aria-label="可添加内容"
            >
              <header>
                <strong>在播放头添加</strong>
                <time>{formatTimecode(positionMs)}</time>
              </header>
              {hasTerminator ? (
                <p className="galgame-playhead-add-popover-note">
                  当前 Fragment 已有分支或章节结局；新内容会插入到它之前。
                </p>
              ) : null}
              <section>
                <strong>画面</strong>
                <div>{blockButtons(["scene", "showCg", "hideCg"])}</div>
              </section>
              <section>
                <strong>高级角色演出</strong>
                <div>
                  {blockButtons(["showCharacter", "removeCharacter"])}
                  <button
                    type="button"
                    onClick={() => runAndClose(onAddAllCharacters)}
                  >
                    全部退场
                  </button>
                </div>
              </section>
              <section>
                <strong>对白</strong>
                <div>{blockButtons(["narration", "dialogue"])}</div>
              </section>
              <section>
                <strong>声音</strong>
                <div>
                  {(
                    Object.keys(AUDIO_LABELS) as (keyof typeof AUDIO_LABELS)[]
                  ).map((channel) => (
                    <button
                      key={`play-${channel}`}
                      type="button"
                      onClick={() =>
                        runAndClose(() => onAddAudio("play", channel))
                      }
                    >
                      {AUDIO_LABELS[channel]}
                    </button>
                  ))}
                  {(
                    Object.keys(AUDIO_LABELS) as (keyof typeof AUDIO_LABELS)[]
                  ).map((channel) => (
                    <button
                      key={`stop-${channel}`}
                      type="button"
                      onClick={() =>
                        runAndClose(() => onAddAudio("stop", channel))
                      }
                    >
                      停止{AUDIO_LABELS[channel]}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <strong>流程</strong>
                <div>{blockButtons(["branch", "endChapter"])}</div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </details>
  );
});
