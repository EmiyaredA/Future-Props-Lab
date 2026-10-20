import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { SlideSurface, SlidePreview } from "./SlideSurface";
import { animationGroups } from "./playback/animationModel";
import { useSlideAnimations } from "./playback/useSlideAnimations";
import type { AudienceOverlay } from "./playback/useAudience";
import type { AnnotationState } from "./playback/ShowAnnotations";
import { useAudience } from "./playback/useAudience";
import { ShowAnnotations, type ShowTool } from "./playback/ShowAnnotations";
import type { Deck } from "./types";
import "./playback/playback.css";

type Position = { index: number; step: number };
export function PresentationShow({
  deck,
  start,
  onClose,
  projectId = "",
  position,
  overlay,
}: {
  deck: Deck;
  start: number;
  onClose: () => void;
  projectId?: string;
  position?: Position;
  overlay?: AudienceOverlay;
}) {
  const [local, setLocal] = useState<Position>({
    index: start,
    step:
      animationGroups(deck.slides[start])[0]?.[0]?.trigger !== "click" &&
      animationGroups(deck.slides[start]).length
        ? 1
        : 0,
  });
  const { index, step } = position ?? local;
  const slide = deck.slides[index];
  const [scale, setScale] = useState(1),
    [auto, setAuto] = useState(false),
    [presenter, setPresenter] = useState(false),
    [thumbnails, setThumbnails] = useState(false);
  const [tool, setTool] = useState<ShowTool>("none"),
    [blackboard, setBlackboard] = useState(false),
    [elapsed, setElapsed] = useState(0);
  const root = useDrawerFocus<HTMLDivElement>(onClose, true, false),
    viewport = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<AnnotationState>({
    marks: [],
    draft: null,
    laser: null,
  });
  const annotationChange = useCallback(
    (state: AnnotationState) => setAnnotations(state),
    [],
  );
  const sourceOverlay = useMemo(
    () => ({ ...annotations, blackboard, index }),
    [annotations, blackboard, index],
  );
  const viewerOverlay =
    position && overlay?.index === index ? overlay : undefined;
  const effectiveBlackboard = position
    ? !!viewerOverlay?.blackboard
    : blackboard;
  const timeline = useSlideAnimations(slide, surface, step);
  const audience = useAudience({
    deck,
    projectId,
    index,
    step,
    overlay: sourceOverlay,
  });
  const choose = (page: number) => {
    if (position) return;
    const next = Math.max(0, Math.min(deck.slides.length - 1, page));
    const first = animationGroups(deck.slides[next])[0]?.[0];
    setLocal({ index: next, step: first && first.trigger !== "click" ? 1 : 0 });
    setBlackboard(false);
  };
  const next = () => {
    if (position || timeline.running) return;
    if (step < timeline.groups) setLocal({ index, step: step + 1 });
    else if (index < deck.slides.length - 1) choose(index + 1);
    else setAuto(false);
  };
  const previous = () => {
    if (position) return;
    if (step > 0) setLocal({ index, step: step - 1 });
    else choose(index - 1);
  };
  const controls = useRef({ next, previous, choose });
  controls.current = { next, previous, choose };
  useEffect(() => {
    const resize = () => {
      const box = viewport.current?.getBoundingClientRect();
      if (box)
        setScale(Math.min(box.width / deck.width, box.height / deck.height));
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [deck.width, deck.height]);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    const key = (event: KeyboardEvent) => {
      if (
        position ||
        event.defaultPrevented ||
        event.isComposing ||
        (event.target as Element)?.closest?.(
          "input,textarea,[contenteditable=true],[role=menu],[role=listbox]",
        )
      )
        return;
      if (event.key === " " && (event.target as Element)?.closest?.("button"))
        return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        controls.current.next();
      }
      if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        controls.current.previous();
      }
      if (event.key === "Home") controls.current.choose(0);
      if (event.key === "End") controls.current.choose(deck.slides.length - 1);
    };
    window.addEventListener("keydown", key);
    const element = root.current;
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", key);
      if (document.fullscreenElement === element)
        void document.exitFullscreen();
    };
  }, [position, deck.slides.length, root]);
  useEffect(() => {
    if (
      position ||
      (!auto && !slide.transition?.advance_after) ||
      (index === deck.slides.length - 1 && step >= timeline.groups)
    )
      return;
    const timer = setInterval(
      () => controls.current.next(),
      (slide.transition?.advance_after ?? 5) * 1000,
    );
    return () => clearInterval(timer);
  }, [
    auto,
    index,
    step,
    timeline.groups,
    deck.slides.length,
    slide.transition?.advance_after,
    position,
  ]);
  useLayoutEffect(() => {
    const effect = slide.transition?.effect;
    if (!effect || effect === "none" || !stage.current?.animate) return;
    const name =
      effect === "random"
        ? ["fade", "slideX", "rotate", "scale"][index % 4]
        : effect;
    const transforms: Record<string, string> = {
      slideX: "translateX(30%)",
      slideY: "translateY(30%)",
      slideX3D: "perspective(800px) rotateY(70deg)",
      slideY3D: "perspective(800px) rotateX(70deg)",
      rotate: "rotate(-30deg)",
      scaleX: "scaleX(.05)",
      scaleY: "scaleY(.05)",
      scale: "scale(.2)",
      scaleReverse: "scale(1.5)",
    };
    const animation = stage.current.animate(
      [
        { opacity: 0, transform: transforms[name] ?? "none" },
        { opacity: 1, transform: "none" },
      ],
      { duration: slide.transition?.duration ?? 600, easing: "ease-out" },
    );
    return () => animation.cancel();
  }, [index, slide.transition]);
  return (
    <div
      ref={root}
      className={`presentation-show${presenter ? " is-presenter" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={position ? "观众放映" : "幻灯片放映"}
    >
      <div className="presentation-show-body">
        <div ref={viewport} className="presentation-show-viewport">
          <div
            ref={stage}
            className="presentation-show-slide"
            style={{ width: deck.width * scale, height: deck.height * scale }}
          >
            <div
              ref={surface}
              style={{
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                width: deck.width,
                height: deck.height,
              }}
            >
              <SlideSurface
                key={slide.id}
                slide={slide}
                size={deck}
                onNavigateSlide={(id) =>
                  choose(deck.slides.findIndex((s) => s.id === id))
                }
                playMedia={!effectiveBlackboard}
              />
            </div>
            {(!position || viewerOverlay) && (
              <ShowAnnotations
                key={slide.id}
                size={deck}
                tool={position ? "none" : tool}
                blackboard={effectiveBlackboard}
                value={position ? viewerOverlay : undefined}
                onChange={position ? undefined : annotationChange}
              />
            )}
          </div>
        </div>
        {presenter && !position && (
          <aside
            className="presentation-presenter-notes"
            aria-label="演讲者视图"
          >
            <h3>演讲者备注</h3>
            <p>{slide.notes || "本页暂无备注"}</p>
            {index + 1 < deck.slides.length && (
              <>
                <h3>下一页</h3>
                <SlidePreview slide={deck.slides[index + 1]} size={deck} />
              </>
            )}
            <p>
              已用时 {Math.floor(elapsed / 60)}:
              {String(elapsed % 60).padStart(2, "0")}
            </p>
          </aside>
        )}
      </div>
      {!position && (
        <>
          {thumbnails && (
            <div
              className="presentation-show-thumbnails"
              aria-label="放映缩略图导航"
            >
              {deck.slides.map((page, i) => (
                <button
                  key={page.id}
                  aria-label={`跳转到第 ${i + 1} 页`}
                  aria-current={index === i ? "page" : undefined}
                  onClick={() => choose(i)}
                >
                  <SlidePreview slide={page} size={deck} width={120} />
                  <span>{i + 1}</span>
                </button>
              ))}
            </div>
          )}
          <nav aria-label="放映控制">
            <button
              aria-label="上一页"
              disabled={index === 0 && step === 0}
              onClick={previous}
            >
              <ChevronLeft />
            </button>
            <span>
              {index + 1} / {deck.slides.length}
            </span>
            <button
              aria-label="下一页"
              disabled={
                timeline.running ||
                (index === deck.slides.length - 1 && step >= timeline.groups)
              }
              onClick={next}
            >
              <ChevronRight />
            </button>
            <button
              aria-label="全屏放映"
              onClick={() =>
                void root.current?.requestFullscreen?.().catch(() => {})
              }
            >
              <Expand size={20} />
            </button>
            <button
              aria-label="缩略图导航"
              aria-pressed={thumbnails}
              onClick={() => setThumbnails(!thumbnails)}
            >
              总览
            </button>
            <button
              aria-label="自动放映"
              aria-pressed={auto}
              onClick={() => setAuto(!auto)}
            >
              自动
            </button>
            <button
              aria-label="演讲者视图"
              aria-pressed={presenter}
              onClick={() => setPresenter(!presenter)}
            >
              备注与计时
            </button>
            {!!projectId && (
              <button aria-label="打开观众窗口" onClick={audience.open}>
                观众窗口
              </button>
            )}
            <button
              aria-label="黑板模式"
              aria-pressed={blackboard}
              onClick={() => setBlackboard(!blackboard)}
            >
              黑板
            </button>
            <button aria-label="退出放映" onClick={onClose}>
              <X size={20} />
            </button>
          </nav>
          <div
            className="presentation-show-tools"
            role="toolbar"
            aria-label="演讲标注工具"
          >
            {(
              [
                "none",
                "laser",
                "pen",
                "marker",
                "arrow",
                "rect",
                "eraser",
              ] as ShowTool[]
            ).map((value, i) => (
              <button
                key={value}
                aria-pressed={tool === value}
                onClick={() => setTool(value)}
              >
                {
                  [
                    "选择",
                    "激光笔",
                    "画笔",
                    "荧光笔",
                    "箭头",
                    "矩形",
                    "橡皮擦",
                  ][i]
                }
              </button>
            ))}
            <span>
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
          </div>
          {audience.error && <p role="alert">{audience.error}</p>}
        </>
      )}
    </div>
  );
}
