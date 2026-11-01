import type { AnnotationState } from "./ShowAnnotations";
export type AudienceOverlay = AnnotationState & {
  blackboard: boolean;
  index: number;
};
import { useEffect, useRef, useState } from "react";
import { AUTH_REQUIRED_EVENT } from "@platform/api/studioAuth";
import type { Deck } from "../types";

export function useAudience({
  deck,
  projectId,
  index,
  step,
  overlay,
}: {
  deck: Deck;
  projectId: string;
  index: number;
  step: number;
  overlay?: AudienceOverlay;
}) {
  const latest = useRef({ deck, index, step, overlay });
  latest.current = { deck, index, step, overlay };
  const session = useRef<{
    channel: BroadcastChannel;
    window: Window | null;
    id: string;
  } | null>(null);
  const [error, setError] = useState("");
  const close = () => {
    const active = session.current;
    if (!active) return;
    active.channel.postMessage({ type: "close" });
    active.channel.close();
    active.window?.close();
    session.current = null;
  };
  useEffect(() => {
    const timer = setInterval(
      () =>
        session.current?.channel.postMessage({
          type: "position",
          index: latest.current.index,
          step: latest.current.step,
        }),
      2000,
    );
    window.addEventListener(AUTH_REQUIRED_EVENT, close);
    return () => {
      clearInterval(timer);
      window.removeEventListener(AUTH_REQUIRED_EVENT, close);
      close();
    };
  }, []);
  useEffect(() => {
    session.current?.channel.postMessage({ type: "position", index, step });
  }, [index, step]);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!overlayTimer.current)
      overlayTimer.current = setTimeout(() => {
        overlayTimer.current = null;
        session.current?.channel.postMessage({
          type: "overlay",
          overlay: latest.current.overlay,
        });
      }, 50);
  }, [overlay]);
  useEffect(
    () => () => {
      if (overlayTimer.current) clearTimeout(overlayTimer.current);
      overlayTimer.current = null;
    },
    [],
  );
  return {
    error,
    open: () => {
      if (typeof BroadcastChannel === "undefined") {
        setError("当前环境不支持独立演示窗口");
        return;
      }
      close();
      setError("");
      const id = crypto.randomUUID(),
        channel = new BroadcastChannel(`fpl-presentation-${id}`);
      session.current = { id, channel, window: null };
      channel.onmessage = (event) => {
        if (event.data?.type === "ready")
          channel.postMessage({
            type: "snapshot",
            projectId,
            ...latest.current,
          });
      };
      const desktop = window.futurePropsDesktop?.openPresentationAudience;
      if (desktop)
        void desktop(projectId, id).catch(() => {
          close();
          setError("无法打开观众窗口");
        });
      else {
        const url = new URL(
          `/apps/presentation-workshop/projects/${encodeURIComponent(projectId)}`,
          location.origin,
        );
        url.searchParams.set("presentationAudience", id);
        const audience = window.open(
          url.href,
          `fpl-audience-${id}`,
          "popup=yes,width=1280,height=800",
        );
        if (!audience) {
          close();
          setError("观众窗口未打开，请允许弹出窗口后重试");
        } else session.current!.window = audience;
      }
    },
  };
}
