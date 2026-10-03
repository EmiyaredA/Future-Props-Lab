import { useCallback, useEffect, useRef, useState } from "react";
import type { PetHabits } from "../api";

/** Old desktop bridges and Live2D keep their established horizontal movement. */
export function useLegacyRoaming(
  enabled: boolean,
  roam: PetHabits["roam"],
  blocked: boolean,
  event: (name: "roam") => void,
) {
  const bounds = useRef({ x: window.screenX, y: window.screenY });
  const epoch = useRef(0),
    pending = useRef(false);
  const latest = useRef({ enabled, roam, blocked, event });
  latest.current = { enabled, roam, blocked, event };
  const [error, setError] = useState("");
  const stopped = roam === "off";
  const move = useCallback(async (mode: PetHabits["roam"]) => {
    const bridge = window.futurePropsDesktop?.movePet;
    if (
      !latest.current.enabled ||
      latest.current.blocked ||
      mode === "off" ||
      pending.current ||
      !bridge
    )
      return;
    pending.current = true;
    const generation = epoch.current;
    const cancelled = () =>
      generation !== epoch.current ||
      !latest.current.enabled ||
      latest.current.blocked ||
      latest.current.roam === "off";
    const start = bounds.current;
    const step = (Math.random() > 0.5 ? 1 : -1) * (mode === "free" ? 55 : 25);
    try {
      let next = await bridge(start.x + step, start.y);
      if (cancelled()) return;
      if (next.x === start.x) next = await bridge(start.x - step, start.y);
      if (cancelled()) return;
      bounds.current = next;
      latest.current.event("roam");
      setError("");
    } catch {
      if (generation === epoch.current)
        setError("走动失败，请关闭桌宠后重新打开");
    } finally {
      pending.current = false;
    }
  }, []);
  useEffect(() => {
    epoch.current += 1;
    return () => {
      epoch.current += 1;
    };
  }, [enabled, blocked, stopped]);
  useEffect(() => {
    if (!enabled || roam === "off") return;
    const timer = window.setInterval(
      () => void move(roam),
      roam === "free" ? 7000 : 17000,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, roam, blocked, move]);
  return {
    error,
    move,
    placed: (position: { x: number; y: number }) => {
      bounds.current = position;
    },
  };
}
