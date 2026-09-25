import { Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
  VideoEditorTransition,
} from "./types";
import "./video-editor-transitions.css";

type TransitionKind = VideoEditorTimelineTransition["kind"];
type Direction = VideoEditorTimelineTransition["direction"];
type Easing = VideoEditorTimelineTransition["easing"];
type ClipEdge = "in" | "out";

type TransitionDefinition = {
  kind: TransitionKind;
  label: string;
  category: string;
  direction: Direction;
  description: string;
  media: "visual" | "audio";
};

const definitions: TransitionDefinition[] = [
  {
    kind: "crossfade",
    label: "交叉淡化",
    category: "叠化",
    direction: "left",
    description: "在前后画面之间平滑混合",
    media: "visual",
  },
  {
    kind: "fade-black",
    label: "黑场过渡",
    category: "基础",
    direction: "left",
    description: "通过完整黑场连接画面",
    media: "visual",
  },
  {
    kind: "fade-white",
    label: "白场过渡",
    category: "基础",
    direction: "left",
    description: "通过完整白场连接画面",
    media: "visual",
  },
  {
    kind: "wipe",
    label: "擦除",
    category: "擦除",
    direction: "left",
    description: "按指定方向揭示或覆盖画面",
    media: "visual",
  },
  {
    kind: "zoom",
    label: "镜头缩放",
    category: "缩放",
    direction: "left",
    description: "用连续缩放连接画面",
    media: "visual",
  },
  {
    kind: "blur",
    label: "径向模糊",
    category: "模糊",
    direction: "left",
    description: "用清晰度变化连接画面",
    media: "visual",
  },
  {
    kind: "flash",
    label: "闪白",
    category: "光效",
    direction: "left",
    description: "在切点产生短促白色脉冲",
    media: "visual",
  },
  {
    kind: "audio-crossfade",
    label: "音频淡化",
    category: "音频",
    direction: "left",
    description: "片段头尾改变增益，重叠区交叉淡化",
    media: "audio",
  },
];

const categories = [
  "全部",
  "基础",
  "叠化",
  "擦除",
  "缩放",
  "模糊",
  "光效",
  "音频",
];
const defaultDurationUs = 500_000;
const clipById = (clips: VideoEditorClip[], id?: string | null) =>
  clips.find((clip) => clip.id === id);
const normalizeKind = (kind: TransitionKind): TransitionKind =>
  kind === "wipe-left" || kind === "wipe-right" ? "wipe" : kind;

export function VideoEditorTransitionPanel({
  clips,
  tracks,
  transitions,
  selectedClip,
  selectedTransitionId,
  target,
  clipEdgeFocus,
  disabled = false,
  commit,
  onSelectTransition,
  onFocusClipEdge,
}: {
  clips: VideoEditorClip[];
  tracks: VideoEditorTrack[];
  transitions: VideoEditorTimelineTransition[];
  selectedClip?: VideoEditorClip;
  selectedTransitionId?: string;
  target?: { fromClipId?: string; toClipId?: string };
  clipEdgeFocus?: ClipEdge;
  disabled?: boolean;
  commit: (
    redo: VideoEditorOperation[],
    undo?: VideoEditorOperation[],
  ) => Promise<void>;
  onSelectTransition: (id?: string) => void;
  onFocusClipEdge?: (edge: ClipEdge) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [kind, setKind] = useState<TransitionKind>("crossfade");
  const [kindTouched, setKindTouched] = useState(false);
  const selectedTransition = transitions.find(
    (item) => item.id === selectedTransitionId,
  );
  const currentFromClip = clipById(
    clips,
    selectedTransition?.fromClipId ?? target?.fromClipId,
  );
  const currentToClip = clipById(
    clips,
    selectedTransition?.toClipId ?? target?.toClipId,
  );
  const trackById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track])),
    [tracks],
  );
  const edgeFocus: ClipEdge = clipEdgeFocus ?? "in";
  const activeEdgeTransition: VideoEditorTransition | undefined =
    (selectedClip &&
      (edgeFocus === "in"
        ? selectedClip.transitionIn
        : selectedClip.transitionOut)) ??
    undefined;
  const audioContext =
    selectedTransition?.kind === "audio-crossfade" ||
    selectedClip?.kind === "audio" ||
    (currentFromClip?.kind === "audio" && currentToClip?.kind === "audio");
  const overlapUs =
    currentFromClip && currentToClip
      ? Math.max(
          0,
          Math.min(
            currentFromClip.timelineStartUs + currentFromClip.durationUs,
            currentToClip.timelineStartUs + currentToClip.durationUs,
          ) - currentToClip.timelineStartUs,
        )
      : 0;
  const visualBetween = Boolean(
    currentFromClip &&
    currentToClip &&
    currentFromClip.trackId === currentToClip.trackId &&
    trackById.get(currentFromClip.trackId)?.kind !== "audio" &&
    currentFromClip.timelineStartUs + currentFromClip.durationUs ===
      currentToClip.timelineStartUs,
  );
  const audioBetween = Boolean(
    currentFromClip &&
    currentToClip &&
    currentFromClip.trackId === currentToClip.trackId &&
    trackById.get(currentFromClip.trackId)?.kind === "audio" &&
    currentFromClip.kind === "audio" &&
    currentToClip.kind === "audio" &&
    currentFromClip.timelineStartUs < currentToClip.timelineStartUs &&
    overlapUs > 0,
  );
  const canApplyBetween = audioContext ? audioBetween : visualBetween;

  useEffect(() => {
    setKindTouched(false);
    if (selectedTransition) {
      setKind(normalizeKind(selectedTransition.kind));
      return;
    }
    if (activeEdgeTransition && activeEdgeTransition.kind !== "cut") {
      setKind(normalizeKind(activeEdgeTransition.kind as TransitionKind));
      return;
    }
    setKind(audioContext ? "audio-crossfade" : "crossfade");
  }, [
    activeEdgeTransition,
    audioContext,
    edgeFocus,
    selectedClip?.id,
    selectedTransition,
  ]);

  const activeKind = normalizeKind(
    kindTouched
      ? kind
      : (selectedTransition?.kind ??
          (activeEdgeTransition?.kind !== "cut"
            ? (activeEdgeTransition?.kind as TransitionKind | undefined)
            : undefined) ??
          (audioContext ? "audio-crossfade" : "crossfade")),
  );
  const availableDefinitions = definitions.filter(
    (item) => item.media === (audioContext ? "audio" : "visual"),
  );
  const selectedDefinition =
    availableDefinitions.find((item) => item.kind === activeKind) ??
    availableDefinitions[0]!;
  const availableCategories = categories.filter(
    (item) =>
      item === "全部" ||
      availableDefinitions.some((definition) => definition.category === item),
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return availableDefinitions.filter(
      (item) =>
        (!query ||
          `${item.label}${item.category}${item.description}`
            .toLowerCase()
            .includes(query)) &&
        (category === "全部" || item.category === category),
    );
  }, [availableDefinitions, category, search]);

  useEffect(() => {
    if (!availableCategories.includes(category)) setCategory("全部");
  }, [availableCategories, category]);

  const transitionDirection = (nextKind: TransitionKind): Direction => {
    if (nextKind !== "wipe") return "left";
    const current =
      selectedTransition?.direction ?? activeEdgeTransition?.direction;
    return ["left", "right", "up", "down"].includes(current ?? "")
      ? (current as Direction)
      : "left";
  };

  const pickKind = (next: TransitionKind) => {
    setKind(next);
    setKindTouched(true);
    const direction = transitionDirection(next);
    if (selectedTransition) {
      void commit(
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: { kind: next, direction },
          },
        ],
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: {
              kind: selectedTransition.kind,
              direction: selectedTransition.direction,
            },
          },
        ],
      );
      return;
    }
    if (selectedClip && activeEdgeTransition) {
      const previous = activeEdgeTransition;
      void commit(
        [
          {
            type: "setTransition",
            clipId: selectedClip.id,
            edge: edgeFocus,
            transition: { ...previous, kind: next, direction },
          },
        ],
        [
          {
            type: "setTransition",
            clipId: selectedClip.id,
            edge: edgeFocus,
            transition: previous,
          },
        ],
      );
    }
  };

  const applyBetween = () => {
    if (disabled || !canApplyBetween || !currentFromClip || !currentToClip) {
      return;
    }
    if (selectedTransition) {
      void commit(
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: {
              kind: selectedDefinition.kind,
              direction: transitionDirection(selectedDefinition.kind),
            },
          },
        ],
        [
          {
            type: "updateTransition",
            transitionId: selectedTransition.id,
            patch: {
              kind: selectedTransition.kind,
              direction: selectedTransition.direction,
            },
          },
        ],
      );
      return;
    }
    const next: VideoEditorTimelineTransition = {
      id: crypto.randomUUID(),
      kind: selectedDefinition.kind,
      durationUs: audioContext ? overlapUs : defaultDurationUs,
      placement: "between",
      fromClipId: currentFromClip.id,
      toClipId: currentToClip.id,
      direction: transitionDirection(selectedDefinition.kind),
      easing: "ease-in-out",
    };
    void commit(
      [{ type: "addTransition", transition: next }],
      [{ type: "removeTransition", transitionId: next.id }],
    ).then(() => onSelectTransition(next.id));
  };

  const applyClipEdge = (edge: ClipEdge) => {
    if (disabled || !selectedClip) return;
    onFocusClipEdge?.(edge);
    const previous =
      edge === "in" ? selectedClip.transitionIn : selectedClip.transitionOut;
    const next: VideoEditorTransition = {
      kind:
        selectedClip.kind === "audio"
          ? "audio-crossfade"
          : selectedDefinition.kind,
      durationUs: previous?.durationUs ?? defaultDurationUs,
      direction: transitionDirection(selectedDefinition.kind),
      easing: previous?.easing ?? "ease-in-out",
    };
    void commit(
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge,
          transition: next,
        },
      ],
      previous
        ? [
            {
              type: "setTransition",
              clipId: selectedClip.id,
              edge,
              transition: previous,
            },
          ]
        : [{ type: "setTransition", clipId: selectedClip.id, edge }],
    );
  };

  const updateSeam = (patch: Partial<VideoEditorTimelineTransition>) => {
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

  const updateClipEdge = (patch: Partial<VideoEditorTransition>) => {
    if (!selectedClip || !activeEdgeTransition || disabled) return;
    const previous = activeEdgeTransition;
    void commit(
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge: edgeFocus,
          transition: { ...previous, ...patch },
        },
      ],
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge: edgeFocus,
          transition: previous,
        },
      ],
    );
  };

  const removeSeam = () => {
    if (!selectedTransition || disabled) return;
    void commit(
      [{ type: "removeTransition", transitionId: selectedTransition.id }],
      [{ type: "addTransition", transition: selectedTransition }],
    ).then(() => onSelectTransition(undefined));
  };
  const removeClipEdge = () => {
    if (!selectedClip || !activeEdgeTransition || disabled) return;
    void commit(
      [{ type: "setTransition", clipId: selectedClip.id, edge: edgeFocus }],
      [
        {
          type: "setTransition",
          clipId: selectedClip.id,
          edge: edgeFocus,
          transition: activeEdgeTransition,
        },
      ],
    );
  };

  const editingParams = selectedTransition
    ? {
        durationUs: selectedTransition.durationUs,
        direction: selectedTransition.direction,
        easing: selectedTransition.easing,
        update: updateSeam,
        remove: removeSeam,
      }
    : activeEdgeTransition
      ? {
          durationUs: activeEdgeTransition.durationUs,
          direction: activeEdgeTransition.direction,
          easing: activeEdgeTransition.easing,
          update: updateClipEdge,
          remove: removeClipEdge,
        }
      : undefined;
  const derivedAudioDuration = selectedTransition?.kind === "audio-crossfade";

  return (
    <aside className="ve-transition-panel">
      <header className="ve-transition-header">
        <div>
          <strong>转场</strong>
          <small>先选择效果，再决定放在片段头、片段尾或片段之间</small>
        </div>
        <SlidersHorizontal aria-hidden />
      </header>
      <label className="ve-transition-search">
        <Search aria-hidden />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索转场"
        />
      </label>
      <div className="ve-transition-categories" role="tablist">
        {availableCategories.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={category === item}
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
            key={item.kind}
            type="button"
            className={`ve-transition-library-card${selectedDefinition.kind === item.kind ? " active" : ""}`}
            onClick={() => pickKind(item.kind)}
          >
            <span
              className={`ve-transition-thumb effect-${item.kind}`}
              aria-hidden
            />
            <span className="ve-transition-card-name">{item.label}</span>
          </button>
        ))}
      </div>

      <section className="ve-transition-editor">
        <div className="ve-transition-editor-title">
          <div>
            <strong>{selectedDefinition.label}</strong>
            <small>{selectedDefinition.description}</small>
          </div>
          {editingParams ? (
            <button
              type="button"
              aria-label="删除当前转场"
              onClick={editingParams.remove}
            >
              <Trash2 aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="ve-transition-field">
          <span>作用位置</span>
          <div className="ve-transition-options wide">
            <button
              type="button"
              className={selectedTransition ? "active" : ""}
              disabled={disabled || (!selectedTransition && !canApplyBetween)}
              onClick={applyBetween}
            >
              应用到片段之间
            </button>
            <button
              type="button"
              className={
                selectedClip && edgeFocus === "in" && !selectedTransition
                  ? "active"
                  : ""
              }
              disabled={disabled || !selectedClip}
              onClick={() => applyClipEdge("in")}
            >
              应用到片段头
            </button>
            <button
              type="button"
              className={
                selectedClip && edgeFocus === "out" && !selectedTransition
                  ? "active"
                  : ""
              }
              disabled={disabled || !selectedClip}
              onClick={() => applyClipEdge("out")}
            >
              应用到片段尾
            </button>
          </div>
        </div>

        {selectedClip ? (
          <p className="ve-transition-help">
            片段「{selectedClip.name}」：片段头{" "}
            {selectedClip.transitionIn
              ? `${(selectedClip.transitionIn.durationUs / 1_000_000).toFixed(2)}s`
              : "无"}
            ，片段尾{" "}
            {selectedClip.transitionOut
              ? `${(selectedClip.transitionOut.durationUs / 1_000_000).toFixed(2)}s`
              : "无"}
          </p>
        ) : null}
        {selectedTransition ? (
          <p className="ve-transition-help">
            当前片段之间：
            {clipById(clips, selectedTransition.fromClipId)?.name ?? "?"} →{" "}
            {clipById(clips, selectedTransition.toClipId)?.name ?? "?"}
          </p>
        ) : canApplyBetween ? (
          <p className="ve-transition-help">
            当前目标：{currentFromClip?.name} → {currentToClip?.name}
          </p>
        ) : !selectedClip ? (
          <p className="ve-transition-help">先选择片段之间的标记或一个片段</p>
        ) : null}

        <label className="ve-transition-field">
          <span>
            时长 <small>{derivedAudioDuration ? "由重叠区决定" : "秒"}</small>
          </span>
          <input
            disabled={!editingParams || disabled || derivedAudioDuration}
            type="number"
            min="0.05"
            max="10"
            step="0.05"
            value={
              editingParams
                ? (editingParams.durationUs / 1_000_000).toFixed(2)
                : "0.50"
            }
            onChange={(event) =>
              editingParams?.update({
                durationUs: Math.round(
                  Number(event.target.value || 0.5) * 1_000_000,
                ),
              })
            }
          />
        </label>
        {selectedDefinition.kind === "wipe" ? (
          <div className="ve-transition-field">
            <span>方向</span>
            <div className="ve-transition-options">
              {(["left", "right", "up", "down"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={!editingParams || disabled}
                  className={editingParams?.direction === item ? "active" : ""}
                  onClick={() => editingParams?.update({ direction: item })}
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
        ) : null}
        <div className="ve-transition-field">
          <span>缓动效果</span>
          <div className="ve-transition-options wide">
            {(["linear", "ease-in", "ease-out", "ease-in-out"] as const).map(
              (item: Easing) => (
                <button
                  key={item}
                  type="button"
                  disabled={!editingParams || disabled}
                  className={editingParams?.easing === item ? "active" : ""}
                  onClick={() => editingParams?.update({ easing: item })}
                >
                  {item === "linear"
                    ? "匀速"
                    : item === "ease-in"
                      ? "前慢后快"
                      : item === "ease-out"
                        ? "前快后慢"
                        : "两端平滑"}
                </button>
              ),
            )}
          </div>
        </div>
      </section>
    </aside>
  );
}
