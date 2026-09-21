import { Search, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
} from "./types";
import "./video-editor-transitions.css";

type TransitionKind = VideoEditorTimelineTransition["kind"];
type Placement = VideoEditorTimelineTransition["placement"];
type Direction = VideoEditorTimelineTransition["direction"];
type Easing = VideoEditorTimelineTransition["easing"];

type TransitionDefinition = {
  kind: TransitionKind;
  label: string;
  category: string;
  direction: Direction;
  description: string;
};

const definitions: TransitionDefinition[] = [
  {
    kind: "crossfade",
    label: "交叉叠化",
    category: "叠化",
    direction: "in",
    description: "两个片段平滑衔接",
  },
  {
    kind: "fade-black",
    label: "黑场淡入",
    category: "基础",
    direction: "in",
    description: "通过黑场完成过渡",
  },
  {
    kind: "fade-white",
    label: "白场淡入",
    category: "基础",
    direction: "in",
    description: "明亮闪白后进入画面",
  },
  {
    kind: "wipe-left",
    label: "向左擦除",
    category: "擦除",
    direction: "left",
    description: "从右侧向左揭示",
  },
  {
    kind: "wipe-right",
    label: "向右擦除",
    category: "擦除",
    direction: "right",
    description: "从左侧向右揭示",
  },
  {
    kind: "zoom",
    label: "镜头缩放",
    category: "缩放",
    direction: "in",
    description: "带有镜头推进感",
  },
  {
    kind: "blur",
    label: "径向模糊",
    category: "模糊",
    direction: "in",
    description: "柔和模糊后清晰",
  },
  {
    kind: "flash",
    label: "闪白",
    category: "光效",
    direction: "in",
    description: "短促高亮闪切",
  },
];

const categories = [
  "全部",
  "收藏",
  "最近",
  "基础",
  "叠化",
  "推拉",
  "擦除",
  "缩放",
  "旋转",
  "模糊",
  "光效",
  "故障",
];

const clipById = (clips: VideoEditorClip[], id?: string | null) =>
  clips.find((clip) => clip.id === id);

export function VideoEditorTransitionPanel({
  clips,
  tracks,
  transitions,
  selectedClip,
  selectedTransitionId,
  target,
  disabled = false,
  commit,
  onSelectTransition,
}: {
  clips: VideoEditorClip[];
  tracks: VideoEditorTrack[];
  transitions: VideoEditorTimelineTransition[];
  selectedClip?: VideoEditorClip;
  selectedTransitionId?: string;
  target?: { placement: Placement; fromClipId?: string; toClipId?: string };
  disabled?: boolean;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onSelectTransition: (id?: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [kind, setKind] = useState<TransitionKind>(
    transitions.find((item) => item.id === selectedTransitionId)?.kind ??
      "crossfade",
  );
  const selectedTransition = transitions.find(
    (item) => item.id === selectedTransitionId,
  );
  const selectedDefinition =
    definitions.find(
      (item) => item.kind === (selectedTransition?.kind ?? kind),
    ) ?? definitions[0]!;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return definitions.filter(
      (item) =>
        (!query ||
          `${item.label}${item.category}${item.description}`
            .toLowerCase()
            .includes(query)) &&
        (category === "全部" ||
          category === "最近" ||
          category === "收藏" ||
          item.category === category),
    );
  }, [category, search]);
  const effectiveTarget =
    target ??
    (selectedClip
      ? { placement: "in" as const, toClipId: selectedClip.id }
      : undefined);
  const currentPlacement =
    selectedTransition?.placement ?? effectiveTarget?.placement;
  const currentFromClip = clipById(
    clips,
    selectedTransition?.fromClipId ?? effectiveTarget?.fromClipId,
  );
  const currentToClip = clipById(
    clips,
    selectedTransition?.toClipId ?? effectiveTarget?.toClipId,
  );
  const canApplyBetween = Boolean(
    currentFromClip &&
    currentToClip &&
    tracks.find((track) => track.id === currentFromClip.trackId)?.kind !==
      "audio" &&
    currentFromClip.timelineStartUs + currentFromClip.durationUs ===
      currentToClip.timelineStartUs,
  );

  const apply = (placement: Placement) => {
    if (disabled) return;
    const fromClipId =
      placement === "between"
        ? currentFromClip?.id
        : placement === "out"
          ? selectedClip?.id
          : undefined;
    const toClipId =
      placement === "between"
        ? currentToClip?.id
        : placement === "in"
          ? selectedClip?.id
          : undefined;
    if (
      (placement === "between" &&
        (!fromClipId || !toClipId || !canApplyBetween)) ||
      (placement !== "between" && !selectedClip)
    )
      return;
    const next: VideoEditorTimelineTransition = {
      id: crypto.randomUUID(),
      kind: selectedDefinition.kind,
      durationUs: selectedTransition?.durationUs ?? 500_000,
      placement,
      fromClipId,
      toClipId,
      direction: selectedDefinition.direction,
      easing: selectedTransition?.easing ?? "ease-in-out",
    };
    void commit(
      [{ type: "addTransition", transition: next }],
      [{ type: "removeTransition", transitionId: next.id }],
    ).then(() => onSelectTransition(next.id));
  };

  const update = (patch: Partial<VideoEditorTimelineTransition>) => {
    if (!selectedTransition || disabled) return;
    const previous = Object.fromEntries(
      Object.keys(patch).map((key) => [
        key,
        selectedTransition[key as keyof VideoEditorTimelineTransition],
      ]),
    );
    void commit(
      [
        {
          type: "updateTransition",
          transitionId: selectedTransition.id,
          patch,
        },
      ],
      [
        {
          type: "updateTransition",
          transitionId: selectedTransition.id,
          patch: previous,
        },
      ],
    );
  };

  const remove = () => {
    if (!selectedTransition || disabled) return;
    void commit(
      [{ type: "removeTransition", transitionId: selectedTransition.id }],
      [{ type: "addTransition", transition: selectedTransition }],
    ).then(() => onSelectTransition(undefined));
  };

  return (
    <aside className="ve-transition-panel">
      <header className="ve-transition-header">
        <div>
          <strong>转场</strong>
          <small>独立转场工作区</small>
        </div>
        <SlidersHorizontal aria-hidden />
      </header>
      <label className="ve-transition-search">
        <Search aria-hidden />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索转场效果…"
        />
      </label>
      <div
        className="ve-transition-categories"
        role="tablist"
        aria-label="转场分类"
      >
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            className={category === item ? "active" : ""}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="ve-transition-library">
        {filtered.map((item) => (
          <button
            type="button"
            key={item.kind}
            className={`ve-transition-library-card${selectedDefinition.kind === item.kind ? " active" : ""}`}
            onClick={() => {
              setKind(item.kind);
              if (selectedTransition)
                update({ kind: item.kind, direction: item.direction });
            }}
          >
            <span
              className={`ve-transition-thumb effect-${item.kind}`}
              aria-hidden
            />
            <span className="ve-transition-card-name">{item.label}</span>
            <Star aria-hidden />
          </button>
        ))}
      </div>
      <section className="ve-transition-editor">
        <div className="ve-transition-editor-title">
          <div>
            <strong>{selectedDefinition.label}</strong>
            <small>{selectedDefinition.description}</small>
          </div>
          {selectedTransition ? (
            <button type="button" aria-label="删除当前转场" onClick={remove}>
              <Trash2 aria-hidden />
            </button>
          ) : null}
        </div>
        <label className="ve-transition-field">
          <span>
            时长 <small>秒</small>
          </span>
          <input
            disabled={!selectedTransition || disabled}
            type="number"
            min="0.05"
            max="10"
            step="0.05"
            value={
              selectedTransition
                ? (selectedTransition.durationUs / 1_000_000).toFixed(2)
                : "0.50"
            }
            onChange={(event) =>
              update({
                durationUs: Math.round(
                  Number(event.target.value || 0.5) * 1_000_000,
                ),
              })
            }
          />
        </label>
        <div className="ve-transition-field">
          <span>方向</span>
          <div className="ve-transition-options">
            {(["left", "right", "up", "down"] as const).map((item) => (
              <button
                key={item}
                type="button"
                disabled={!selectedTransition || disabled}
                className={
                  selectedTransition?.direction === item ? "active" : ""
                }
                onClick={() => update({ direction: item })}
              >
                {item === "left"
                  ? "左"
                  : item === "right"
                    ? "右"
                    : item === "up"
                      ? "上"
                      : "下"}
              </button>
            ))}
          </div>
        </div>
        <div className="ve-transition-field">
          <span>缓动效果</span>
          <div className="ve-transition-options wide">
            {(["linear", "ease-in", "ease-out", "ease-in-out"] as const).map(
              (item: Easing) => (
                <button
                  key={item}
                  type="button"
                  disabled={!selectedTransition || disabled}
                  className={
                    selectedTransition?.easing === item ? "active" : ""
                  }
                  onClick={() => update({ easing: item })}
                >
                  {item === "linear"
                    ? "匀速"
                    : item === "ease-in"
                      ? "渐入"
                      : item === "ease-out"
                        ? "渐出"
                        : "平滑"}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="ve-transition-actions">
          <button
            type="button"
            disabled={disabled || !canApplyBetween}
            onClick={() => apply("between")}
          >
            应用到接缝
          </button>
          <button
            type="button"
            disabled={disabled || !selectedClip}
            onClick={() => apply("in")}
          >
            应用到片段开头
          </button>
          <button
            type="button"
            disabled={disabled || !selectedClip}
            onClick={() => apply("out")}
          >
            应用到片段结尾
          </button>
        </div>
        {currentPlacement ? (
          <p className="ve-transition-help">
            当前目标：
            {currentPlacement === "between"
              ? "两个相邻片段之间"
              : currentPlacement === "in"
                ? "片段开头"
                : "片段结尾"}
          </p>
        ) : (
          <p className="ve-transition-help">先选择时间线上的接缝或片段</p>
        )}
      </section>
    </aside>
  );
}
