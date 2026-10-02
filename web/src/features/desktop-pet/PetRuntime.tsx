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
  hoverActions: ["dress", "roam", "hide", "chat"],
};

function playTone(kind: "none" | "tap" | "chime") {
  if (kind === "none") return;
  let audio: AudioContext;
  try {
    audio = new AudioContext();
  } catch {
    return;
  }
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = kind === "tap" ? 520 : 760;
  gain.gain.setValueAtTime(0.06, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.18);
  oscillator.onended = () => {
    void audio.close();
  };
}

export function PetRuntime({ projectId }: { projectId: string }) {
  const [document, setDocument] = useState<PetDocument | null>(null);
  const [error, setError] = useState("");
  const [skinId, setSkinId] = useState<string | null>(null);
  const [roam, setRoam] = useState<PetHabits["roam"]>("calm");
  const [eventName, setEventName] = useState<EventName>("idle");
  const [reactionKey, setReactionKey] = useState(0);
  const [bubble, setBubble] = useState("");
  const [hovered, setHovered] = useState(false);
  const [proactive, setProactive] = useState(true);
  const chatOpen = useRef(false);
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
  const currentBounds = useRef({ x: window.screenX, y: window.screenY });
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
      if (value.phase === "open") chatOpen.current = true;
      if (value.phase === "closed") {
        chatOpen.current = false;
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
        if (document?.config.habits?.bubbles !== false) setBubble("正在思考…");
      }
      if (value.phase === "speaking" || value.phase === "done") {
        setEventName("chatSpeaking");
        setReactionKey((key) => key + 1);
        if (document?.config.habits?.bubbles !== false)
          setBubble(value.text ?? "");
        if (value.phase === "done") {
          if (idleTimer.current) clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => setEventName("idle"), 1800);
          bubbleTimer.current = setTimeout(() => setBubble(""), 3200);
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
  }, [projectId, document]);

  useEffect(() => {
    let alive = true;
    void getDocument(projectId)
      .then((value) => {
        if (!alive) return;
        setDocument(value);
        setSkinId(
          value.sourceType === "coopanion-whale"
            ? (value.config.schemeId ?? "deepseek")
            : (value.config.activeSkinId ?? null),
        );
        setRoam(value.config.habits?.roam ?? "calm");
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [projectId]);
  const habits = document?.config.habits ?? DEFAULT_HABITS;
  const trigger = useCallback(
    (name: EventName) => {
      if (!document) return;
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
      if (habits.sound && reaction?.sound) playTone(reaction.sound);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (name !== "idle")
        idleTimer.current = setTimeout(() => setEventName("idle"), 1800);
    },
    [document, habits.bubbles, habits.sound],
  );
  useEffect(() => {
    if (!document || !proactive || !document.config.events?.idle?.lines?.length)
      return;
    let cancelled = false;
    const schedule = () => {
      proactiveTimer.current = setTimeout(
        () => {
          if (!cancelled && !drag.current && !chatOpen.current) trigger("idle");
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
  }, [document, proactive, trigger]);
  useEffect(
    () => () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (proactiveTimer.current) clearTimeout(proactiveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!document || roam === "off") return;
    const timer = window.setInterval(
      () => {
        if (drag.current) return;
        trigger("roam");
        const sign = Math.random() > 0.5 ? 1 : -1;
        const step = roam === "free" ? 55 : 25;
        void window.futurePropsDesktop
          ?.movePet?.(window.screenX + sign * step, window.screenY)
          .then((bounds) => {
            if (bounds) currentBounds.current = bounds;
          });
      },
      roam === "free" ? 7000 : 17000,
    );
    return () => window.clearInterval(timer);
  }, [document, roam, trigger]);

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
      const start = drag.current;
      const dx = event.screenX - start.screenX;
      const dy = event.screenY - start.screenY;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      if (start.moved && habits.draggable) {
        if (!start.grabbed) {
          start.grabbed = true;
          trigger("grab");
        }
        void window.futurePropsDesktop
          ?.movePet?.(start.x + dx, start.y + dy)
          .then((bounds) => {
            if (bounds) currentBounds.current = bounds;
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
      event.clientY >= character.top &&
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
    currentBounds.current = { x: window.screenX, y: window.screenY };
    drag.current = {
      ...currentBounds.current,
      screenX: event.screenX,
      screenY: event.screenY,
      moved: false,
      grabbed: false,
    };
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const started = drag.current;
    drag.current = null;
    if (!started) return;
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
    if (!document) return;
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
  const cycleRoam = () =>
    setRoam((value) =>
      value === "calm" ? "free" : value === "free" ? "off" : "calm",
    );
  const action = (id: string) => {
    if (id === "dress") cycleSkin();
    if (id === "roam") cycleRoam();
    if (id === "hide") void window.futurePropsDesktop?.hidePet?.();
    if (id === "settings")
      void window.futurePropsDesktop?.showStudioFromPet?.();
    if (id === "chat") void window.futurePropsDesktop?.openPetChat?.();
  };
  return (
    <div
      className="pet-runtime"
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerLeave={() => {
        if (!drag.current) setInteractive(false);
      }}
    >
      {document && (
        <div
          ref={characterHost}
          className={`pet-runtime-character${eventName === "chatThinking" ? " pet-chat-thinking" : eventName === "chatSpeaking" ? " pet-chat-speaking" : ""}`}
          style={{ height: habits.size, width: habits.size * 0.75 }}
        >
          <DesktopPetFigure
            ref={renderer}
            document={document}
            skinId={skinId}
            eventName={eventName}
            reactionKey={reactionKey}
          />
        </div>
      )}
      {bubble && <div className="pet-runtime-bubble">{bubble}</div>}
      {hovered && Boolean(habits.hoverActions?.length) && (
        <div className="pet-runtime-actions">
          {habits.hoverActions?.map((id) => (
            <button
              key={id}
              type="button"
              title={
                {
                  dress: "换装",
                  roam: "走动",
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
      {error && (
        <div className="pet-runtime-error" role="alert">
          桌宠加载失败
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
