import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { getChat, getDocument, type PetDocument, type PetHabits } from "./api";
import { DesktopPetFigure } from "./DesktopPetFigure";
import type { PetRendererHandle } from "./PetRenderer";
import { usePetPreview } from "./usePetPreview";
import { playPetTone } from "./sound";
import { playbackDuration, type PetEvent } from "./playback";
import { usePetLocomotion } from "./locomotion/usePetLocomotion";
import { useLegacyRoaming } from "./locomotion/useLegacyRoaming";
import { useTheme } from "@shared/ui/theme";
import "@shared/ui/theme.css";
import "./runtime.css";

type EventName =
  | "idle"
  | "click"
  | "pet"
  | "grab"
  | "drop"
  | "roam"
  | "chatThinking"
  | "chatSpeaking";
const DEFAULT_HABITS: PetHabits = {
  roam: "calm",
  size: 220,
  draggable: true,
  bubbles: true,
  sound: true,
  edgeClimbing: true,
  highGliding: true,
  hoverActions: ["dress", "roam", "hide", "chat"],
};
const ROAM_LABELS = { calm: "多待着", free: "常走动", off: "不乱动" };

export function PetRuntime({ projectId }: { projectId: string }) {
  useTheme();
  const [document, setDocument] = useState<PetDocument | null>(null);
  const [error, setError] = useState("");
  const [skinId, setSkinId] = useState<string | null>(null);
  const [roam, setRoam] = useState<PetHabits["roam"]>("calm");
  const [eventName, setEventName] = useState<EventName>("idle");
  const [reactionKey, setReactionKey] = useState(0);
  const [bubble, setBubble] = useState("");
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [chatActive, setChatActive] = useState(false);
  const [proactive, setProactive] = useState(true);
  const chatOpen = useRef(false);
  const skinOverride = useRef(false);
  const roamOverride = useRef(false);
  const lastLine = useRef<Record<string, number>>({});
  const interactive = useRef(false);
  const renderer = useRef<PetRendererHandle>(null);
  const characterHost = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    moved: boolean;
    grabbed: boolean;
  } | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proactiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void getChat(projectId)
      .then((value) => {
        if (alive) setProactive(value.proactiveLinesEnabled);
      })
      .catch(() => undefined);
    const off = window.futurePropsDesktop?.onPetChatState?.((value) => {
      if (value.phase === "open") {
        chatOpen.current = true;
        setChatActive(true);
        if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
        setBubble("");
      }
      if (value.phase === "closed") {
        chatOpen.current = false;
        setChatActive(false);
        setEventName("idle");
        setBubble("");
        void getChat(projectId)
          .then((next) => {
            if (alive) setProactive(next.proactiveLinesEnabled);
          })
          .catch(() => undefined);
      }
      if (value.phase === "thinking") {
        if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
        setEventName("chatThinking");
        setReactionKey((key) => key + 1);
      }
      if (value.phase === "speaking" || value.phase === "done") {
        setEventName("chatSpeaking");
        setReactionKey((key) => key + 1);
        if (value.phase === "done") {
          if (idleTimer.current) clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => setEventName("idle"), 1800);
        }
      }
      if (value.phase === "error") {
        setEventName("idle");
        setBubble("");
      }
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void getDocument(projectId)
        .then((value) => {
          if (!alive) return;
          setDocument((current) =>
            !current || value.revision >= current.revision ? value : current,
          );
          setError("");
        })
        .catch((cause) => {
          if (alive) setError(String(cause));
        });
    refresh();
    const off = window.futurePropsDesktop?.onPetResourcesChanged?.(refresh);
    return () => {
      alive = false;
      off?.();
    };
  }, [projectId]);
  useEffect(() => {
    if (!document) return;
    if (
      !skinOverride.current ||
      (document.sourceType === "coopanion-whale" &&
        !(document.whaleModel?.schemes as { id: string }[] | undefined)?.some(
          (scheme) => scheme.id === skinId,
        ))
    )
      setSkinId(
        document.sourceType === "coopanion-whale"
          ? (document.config.schemeId ?? "deepseek")
          : (document.config.activeSkinId ?? null),
      );
    if (!roamOverride.current) setRoam(document.config.habits?.roam ?? "calm");
  }, [document, skinId]);
  const preview = usePetPreview(projectId, setDocument);
  const displayedDocument = preview.display?.document ?? document;
  const habits = displayedDocument?.config.habits ?? DEFAULT_HABITS;
  useEffect(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    if (!chatOpen.current) setEventName("idle");
    setBubble("");
  }, [preview.linked]);
  const trigger = useCallback(
    (name: EventName) => {
      if (!document || preview.linked) return;
      setEventName(name);
      setReactionKey((value) => value + 1);
      const reaction = document.config.events?.[name];
      const lines = reaction?.lines ?? [];
      if (lines.length && habits.bubbles && !chatOpen.current) {
        const previous = lastLine.current[name] ?? -1;
        const next = (previous + 1) % lines.length;
        lastLine.current[name] = next;
        setBubble(lines[next]);
        if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
        bubbleTimer.current = setTimeout(() => setBubble(""), 3200);
      }
      if (habits.sound && reaction?.sound) playPetTone(reaction.sound);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (name !== "idle")
        idleTimer.current = setTimeout(
          () => setEventName("idle"),
          playbackDuration(document, name as PetEvent),
        );
    },
    [document, habits.bubbles, habits.sound, preview.linked],
  );
  useEffect(() => {
    if (!document || !proactive || !document.config.events?.idle?.lines?.length)
      return;
    let cancelled = false;
    const schedule = () => {
      proactiveTimer.current = setTimeout(
        () => {
          if (
            !cancelled &&
            !drag.current &&
            !chatOpen.current &&
            !preview.linked
          )
            trigger("idle");
          if (!cancelled) schedule();
        },
        (3 + Math.random() * 3) * 60_000,
      );
    };
    schedule();
    return () => {
      cancelled = true;
      if (proactiveTimer.current) clearTimeout(proactiveTimer.current);
    };
  }, [document, proactive, trigger, preview.linked]);
  useEffect(
    () => () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (proactiveTimer.current) clearTimeout(proactiveTimer.current);
    },
    [],
  );

  const continuous = Boolean(
    document?.sourceType === "coopanion-whale" &&
    window.futurePropsDesktop?.movePetFrame &&
    window.futurePropsDesktop.petEnvironment,
  );
  const movement = usePetLocomotion({
    enabled: continuous,
    settings: {
      roam,
      size: habits.size,
      edgeClimbing: habits.edgeClimbing ?? true,
      highGliding: habits.highGliding ?? true,
    },
    blocked: chatActive || preview.linked,
    geometry: () => renderer.current?.geometry?.() ?? null,
    onEvent: trigger,
  });
  const legacy = useLegacyRoaming(
    Boolean(document) && !continuous,
    roam,
    pressed || chatActive || preview.linked,
    trigger,
  );
  const roamError = movement.error || legacy.error;

  const hit = (event: PointerEvent<HTMLDivElement>) =>
    renderer.current?.hitTest(event.clientX, event.clientY) ?? false;
  const setInteractive = (value: boolean) => {
    if (interactive.current === value) return;
    interactive.current = value;
    setHovered(value);
    void window.futurePropsDesktop?.setPetInteractive?.(value);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    renderer.current?.pointerMove?.(event.clientX, event.clientY);
    if (drag.current) {
      if (continuous && habits.draggable) {
        movement.pointer(event.screenX, event.screenY);
        return;
      }
      const start = drag.current;
      const dx = event.screenX - start.screenX;
      const dy = event.screenY - start.screenY;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      if (start.moved && habits.draggable) {
        if (!start.grabbed) {
          start.grabbed = true;
          setDragging(true);
          trigger("grab");
        }
        void window.futurePropsDesktop
          ?.movePet?.(start.x + dx, start.y + dy)
          .then((bounds) => {
            if (bounds) {
              legacy.placed(bounds);
              start.x = bounds.x - dx;
              start.y = bounds.y - dy;
            }
          });
      }
      return;
    }
    // Keep the small transparent path from the figure's feet to its buttons
    // interactive while the tray is open. Otherwise Electron starts passing
    // clicks through before the pointer can reach a button.
    const character = characterHost.current?.getBoundingClientRect();
    const actionPath =
      interactive.current &&
      character &&
      Math.abs(event.clientX - (character.left + character.right) / 2) <=
        Math.max(character.width / 2 + 12, 92) &&
      event.clientY >= character.top - 42 &&
      event.clientY <= window.innerHeight;
    setInteractive(
      hit(event) ||
        Boolean(actionPath) ||
        Boolean((event.target as HTMLElement).closest("button")),
    );
  };
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !document ||
      !hit(event) ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressed(true);
    if (continuous && habits.draggable)
      movement.press(event.screenX, event.screenY);
    drag.current = {
      x: window.screenX,
      y: window.screenY,
      screenX: event.screenX,
      screenY: event.screenY,
      moved: false,
      grabbed: false,
    };
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const started = drag.current;
    drag.current = null;
    setDragging(false);
    setPressed(false);
    if (!started) return;
    if (continuous && habits.draggable && !movement.release()) return;
    if (started.moved && habits.draggable) trigger("drop");
    else {
      const bounds = characterHost.current?.getBoundingClientRect();
      trigger(
        bounds && event.clientY < bounds.top + bounds.height * 0.48
          ? "pet"
          : "click",
      );
    }
  };
  const cycleSkin = () => {
    if (!document || preview.linked) return;
    skinOverride.current = true;
    if (document.sourceType === "coopanion-whale") {
      const ids =
        (document.whaleModel?.schemes as { id: string }[] | undefined)?.map(
          (item) => item.id,
        ) ?? [];
      if (ids.length)
        setSkinId(ids[(ids.indexOf(skinId ?? "") + 1) % ids.length]);
      return;
    }
    const ids = [null, ...(document.config.skins ?? []).map((skin) => skin.id)];
    setSkinId(ids[(ids.indexOf(skinId) + 1) % ids.length]);
  };
  const cycleRoam = () => {
    if (preview.linked) return;
    roamOverride.current = true;
    const next = roam === "calm" ? "free" : roam === "free" ? "off" : "calm";
    setRoam(next);
    if (!continuous) void legacy.move(next);
  };
  const action = (id: string) => {
    if (id === "dress") cycleSkin();
    if (id === "roam") cycleRoam();
    if (id === "hide") void window.futurePropsDesktop?.hidePet?.();
    if (id === "settings")
      void window.futurePropsDesktop?.showStudioFromPet?.();
    if (id === "chat") void window.futurePropsDesktop?.openPetChat?.();
  };
  const displayedBubble = preview.display
    ? preview.display.draft.mode !== "runtime" && habits.bubbles
      ? (preview.display.document.config.events?.[
          preview.display.draft.eventName
        ]?.lines?.[preview.display.draft.line] ?? "")
      : ""
    : bubble;
  return (
    <div
      className="pet-runtime"
      data-motion={movement.frame.state}
      style={
        movement.environment
          ? ({
              "--pet-visible-left": `${movement.environment.workArea.x - movement.environment.bounds.x}px`,
              "--pet-visible-top": `${movement.environment.workArea.y - movement.environment.bounds.y}px`,
              "--pet-visible-right": `${movement.environment.workArea.x + movement.environment.workArea.width - movement.environment.bounds.x}px`,
              "--pet-visible-bottom": `${movement.environment.workArea.y + movement.environment.workArea.height - movement.environment.bounds.y}px`,
              "--pet-actions-bottom":
                movement.shape &&
                movement.environment.workArea.y +
                  movement.environment.workArea.height -
                  (movement.environment.bounds.y + movement.shape.feet.y) <
                  42
                  ? `${movement.environment.bounds.height - movement.shape.visible.y + 6}px`
                  : undefined,
            } as import("react").CSSProperties)
          : undefined
      }
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => {
        const grabbed = drag.current?.grabbed;
        drag.current = null;
        setDragging(false);
        setPressed(false);
        if (continuous) movement.release(true);
        else if (grabbed) trigger("drop");
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        drag.current = null;
        setPressed(false);
        setDragging(false);
        if (continuous) movement.release(true);
      }}
      onPointerLeave={() => {
        if (!drag.current) setInteractive(false);
      }}
    >
      {displayedDocument && (
        <div
          ref={characterHost}
          className={`pet-runtime-character${eventName === "chatThinking" ? " pet-chat-thinking" : eventName === "chatSpeaking" ? " pet-chat-speaking" : ""}`}
          style={{ height: habits.size, width: habits.size * 0.75 }}
        >
          <DesktopPetFigure
            ref={renderer}
            document={displayedDocument}
            skinId={preview.display ? preview.display.draft.skinId : skinId}
            eventName={
              preview.display ? preview.display.draft.eventName : eventName
            }
            reactionKey={
              preview.display ? preview.display.draft.key : reactionKey
            }
            playbackMode={preview.display?.draft.mode ?? "runtime"}
            dragged={dragging || movement.frame.state === "held"}
            locomotion={movement.frame}
            motionDemo={preview.display?.draft.motionDemo}
          />
        </div>
      )}
      {preview.linked && (
        <div className="pet-runtime-preview-status">
          {preview.paused ? "聊天中，联动暂停" : "临时预览，尚未保存"}
        </div>
      )}
      {displayedBubble && (
        <div className="pet-runtime-bubble">{displayedBubble}</div>
      )}
      {hovered && Boolean(habits.hoverActions?.length) && (
        <div className="pet-runtime-actions">
          {habits.hoverActions?.map((id) => (
            <button
              key={id}
              type="button"
              title={
                {
                  dress: "换装",
                  roam: `走动：${ROAM_LABELS[roam]}（点击切换）`,
                  hide: "隐藏",
                  settings: "设置",
                  chat: "聊天",
                }[id]
              }
              aria-label={
                id === "roam"
                  ? `走动：${ROAM_LABELS[roam]}`
                  : {
                      dress: "换装",
                      hide: "隐藏",
                      settings: "设置",
                      chat: "聊天",
                    }[id]
              }
              onClick={() => action(id)}
            >
              {
                (
                  {
                    dress: "✿",
                    roam: "↝",
                    hide: "−",
                    settings: "⚙",
                    chat: "✉",
                  } as Record<string, string>
                )[id]
              }
            </button>
          ))}
        </div>
      )}
      {(error || roamError || preview.error) && (
        <div className="pet-runtime-error" role="alert">
          {error ? "桌宠加载失败" : preview.error || roamError}
          <button
            onClick={() =>
              void window.futurePropsDesktop?.showStudioFromPet?.()
            }
          >
            打开应用
          </button>
        </div>
      )}
    </div>
  );
}
