import {
  transitionDefinitions as definitions,
  transitionCategories as categories,
  directionalTransition,
  transitionDefaultDuration,
} from "./transitionCatalog";
import { Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import { useEffect, useMemo, useState } from "react";
import { audioTransitionOperations } from "./audioTransitionOperations";
import { audioTransitionKinds } from "./audioTransitionCurves";
import { useAudioTransitionAudition } from "./useAudioTransitionAudition";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorOperation,
  VideoEditorTimeline,
  VideoEditorTimelineTransition,
  VideoEditorTrack,
  VideoEditorTransition,
} from "./types";
import "./video-editor-transitions.css";

type TransitionKind = VideoEditorTimelineTransition["kind"];
type Direction = VideoEditorTimelineTransition["direction"];
type Easing = VideoEditorTimelineTransition["easing"];
type ClipEdge = "in" | "out";

const defaultDurationUs = 500_000;
const clipById = (clips: VideoEditorClip[], id?: string | null) =>
  clips.find((clip) => clip.id === id);
const normalizeKind = (kind: TransitionKind): TransitionKind =>
  kind === "wipe-left" || kind === "wipe-right" ? "wipe" : kind;

export function VideoEditorTransitionPanel({
  timeline,
  assets = [],
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
  timeline?: VideoEditorTimeline;
  assets?: VideoEditorAsset[];
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
  const [audioDurationUs, setAudioDurationUs] = useState(defaultDurationUs);
  const [audioEasing, setAudioEasing] = useState<Easing>("ease-in-out");
  const [audioError, setAudioError] = useState("");
  const audition = useAudioTransitionAudition();
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
  const fromProxy = useApiBlobUrl(
    assets.find((asset) => asset.id === currentFromClip?.assetId)?.proxyUrl,
  );
  const toProxy = useApiBlobUrl(
    assets.find((asset) => asset.id === currentToClip?.assetId)?.proxyUrl,
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
    (selectedTransition &&
      audioTransitionKinds.includes(
        selectedTransition.kind as (typeof audioTransitionKinds)[number],
      )) ||
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
    overlapUs >= 0 &&
    currentFromClip.timelineStartUs + currentFromClip.durationUs >=
      currentToClip.timelineStartUs,
  );
  const canApplyBetween = audioContext ? audioBetween : visualBetween;
  const maxBetweenDurationUs = Math.min(
    10_000_000,
    currentFromClip?.durationUs ?? 10_000_000,
    currentToClip?.durationUs ?? 10_000_000,
  );
  const maxClipDurationUs = Math.min(
    10_000_000,
    selectedClip?.durationUs ?? 10_000_000,
  );
  const maxVisualDurationUs = selectedTransition
    ? maxBetweenDurationUs
    : maxClipDurationUs;
  const audioNeedsSeparation = Boolean(
    audioBetween &&
    (currentFromClip?.linkGroupId || currentToClip?.linkGroupId),
  );

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
  useEffect(() => {
    const maximum = Math.min(
      10_000_000,
      (currentFromClip?.durationUs ?? 10_000_001) - 1,
      (currentToClip?.durationUs ?? 10_000_001) - 1,
    );
    setAudioDurationUs(
      Math.min(
        maximum,
        (selectedTransition?.durationUs ?? overlapUs) || defaultDurationUs,
      ),
    );
    setAudioEasing(selectedTransition?.easing ?? "ease-in-out");
  }, [
    currentFromClip?.id,
    currentFromClip?.durationUs,
    currentToClip?.id,
    currentToClip?.durationUs,
    selectedTransition?.id,
    selectedTransition?.durationUs,
    selectedTransition?.easing,
    overlapUs,
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
          `${item.label}${item.category}${item.description}${item.keywords ?? ""}`
            .toLowerCase()
            .includes(query)) &&
        (category === "全部" || item.category === category),
    );
  }, [availableDefinitions, category, search]);

  useEffect(() => {
    if (!availableCategories.includes(category)) setCategory("全部");
  }, [availableCategories, category]);

  const transitionDirection = (nextKind: TransitionKind): Direction => {
    if (!directionalTransition(nextKind)) return "left";
    const current =
      selectedTransition?.direction ?? activeEdgeTransition?.direction;
    return ["left", "right", "up", "down"].includes(current ?? "")
      ? (current as Direction)
      : "left";
  };

  const pickKind = (next: TransitionKind) => {
    audition.stop();
    setAudioError("");
    setKind(next);
    setKindTouched(true);
    if (audioContext || disabled) return;
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
            transition: {
              ...previous,
              kind: next as VideoEditorTransition["kind"],
              direction,
            },
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
    if (
      disabled ||
      audioNeedsSeparation ||
      !canApplyBetween ||
      !currentFromClip ||
      !currentToClip
    ) {
      return;
    }
    if (audioContext) {
      audition.stop();
      const { redo, undo, id } = audioTransitionOperations(
        timeline ??
          ({
            document: {
              tracks: tracks.map((track) => ({
                ...track,
                clips: clips.filter((clip) => clip.trackId === track.id),
              })),
              transitions,
            },
          } as VideoEditorTimeline),
        currentFromClip,
        currentToClip,
        selectedTransition,
        selectedDefinition.kind as (typeof audioTransitionKinds)[number],
        audioDurationUs,
        audioEasing,
      );
      void commit(redo, undo)
        .then(() => onSelectTransition(id))
        .catch((error: unknown) =>
          setAudioError(
            error instanceof Error ? error.message : "音频转场应用失败",
          ),
        );
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
      durationUs: Math.min(
        transitionDefaultDuration(selectedDefinition.kind),
        maxBetweenDurationUs,
      ),
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
          : (selectedDefinition.kind as VideoEditorTransition["kind"]),
      durationUs: Math.min(
        previous?.durationUs ??
          transitionDefaultDuration(selectedDefinition.kind),
        maxClipDurationUs,
      ),
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
  const audioBetweenControls = audioContext && canApplyBetween;
  const activeParams = audioBetweenControls
    ? {
        durationUs: audioDurationUs,
        direction: "left" as Direction,
        easing: audioEasing,
        update: (patch: { durationUs?: number; easing?: Easing }) => {
          if (patch.durationUs !== undefined)
            setAudioDurationUs(patch.durationUs);
          if (patch.easing !== undefined) setAudioEasing(patch.easing);
        },
        remove: selectedTransition ? removeSeam : undefined,
      }
    : editingParams;
  const maxAudioDurationUs = Math.min(
    10_000_000,
    (currentFromClip?.durationUs ?? 0) - 1,
    (currentToClip?.durationUs ?? 0) - 1,
  );

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
          aria-label="搜索转场"
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
            aria-pressed={selectedDefinition.kind === item.kind}
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
          {activeParams?.remove ? (
            <button
              type="button"
              aria-label="删除当前转场"
              onClick={activeParams.remove}
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
              disabled={
                disabled ||
                audioNeedsSeparation ||
                (!selectedTransition && !canApplyBetween) ||
                (audioContext && maxAudioDurationUs < 50_000)
              }
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
              disabled={
                disabled ||
                !selectedClip ||
                (audioContext && selectedDefinition.kind !== "audio-crossfade")
              }
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
              disabled={
                disabled ||
                !selectedClip ||
                (audioContext && selectedDefinition.kind !== "audio-crossfade")
              }
              onClick={() => applyClipEdge("out")}
            >
              应用到片段尾
            </button>
          </div>
        </div>
        {audioBetweenControls ? (
          <div className="ve-transition-audio-audition">
            <button
              type="button"
              disabled={
                !fromProxy.url ||
                !toProxy.url ||
                fromProxy.loading ||
                toProxy.loading
              }
              onClick={() => {
                if (audition.playing) {
                  audition.stop();
                  return;
                }
                setAudioError("");
                void audition
                  .play(
                    fromProxy.url!,
                    toProxy.url!,
                    currentFromClip!,
                    currentToClip!,
                    selectedDefinition.kind as (typeof audioTransitionKinds)[number],
                    audioDurationUs,
                    audioEasing,
                  )
                  .catch((error: unknown) =>
                    setAudioError(
                      error instanceof Error ? error.message : "预听失败",
                    ),
                  );
              }}
            >
              {audition.playing
                ? "停止预听"
                : fromProxy.loading || toProxy.loading
                  ? "加载预听…"
                  : "预听接缝"}
            </button>
            {audioError ? <p role="alert">{audioError}</p> : null}
          </div>
        ) : null}
        {audioContext && selectedDefinition.kind !== "audio-crossfade" ? (
          <p className="ve-transition-help">
            此效果用于两段音频之间；片段头尾可用交叉淡化。
          </p>
        ) : null}
        {audioNeedsSeparation ? (
          <p className="ve-transition-help">
            请先分离与画面关联的音频片段，再应用接缝转场。
          </p>
        ) : null}

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
        ) : audioContext && currentFromClip && currentToClip ? (
          <p className="ve-transition-help">请先将两段音频在同一轨上对齐。</p>
        ) : !selectedClip ? (
          <p className="ve-transition-help">先选择片段之间的标记或一个片段</p>
        ) : null}

        <label className="ve-transition-field">
          <span>
            时长{" "}
            <small>
              {audioBetweenControls ? "秒 · 应用后由重叠区决定" : "秒"}
            </small>
          </span>
          <input
            disabled={!activeParams || disabled}
            type="number"
            min={
              audioBetweenControls
                ? Math.min(50_000, maxAudioDurationUs) / 1_000_000
                : 0.000001
            }
            max={
              audioBetweenControls
                ? maxAudioDurationUs / 1_000_000
                : maxVisualDurationUs / 1_000_000
            }
            step="0.05"
            value={
              activeParams
                ? activeParams.durationUs / 1_000_000
                : Math.min(
                    transitionDefaultDuration(selectedDefinition.kind),
                    maxVisualDurationUs,
                  ) / 1_000_000
            }
            onChange={(event) =>
              activeParams?.update({
                durationUs: audioBetweenControls
                  ? Math.min(
                      maxAudioDurationUs,
                      Math.max(
                        50_000,
                        Math.round(
                          Number(event.target.value || 0.5) * 1_000_000,
                        ),
                      ),
                    )
                  : Math.min(
                      maxVisualDurationUs,
                      Math.max(
                        1,
                        Math.round(
                          Number(event.target.value || 0.5) * 1_000_000,
                        ),
                      ),
                    ),
              })
            }
          />
        </label>
        {directionalTransition(selectedDefinition.kind) ? (
          <div className="ve-transition-field">
            <span>方向</span>
            <div className="ve-transition-options">
              {(["left", "right", "up", "down"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  disabled={!activeParams || disabled}
                  className={activeParams?.direction === item ? "active" : ""}
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
                  disabled={!activeParams || disabled}
                  className={activeParams?.easing === item ? "active" : ""}
                  onClick={() => activeParams?.update({ easing: item })}
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
