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
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
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
    fallbackUrl,
    open: () => {
      if (typeof BroadcastChannel === "undefined") {
        setError("当前环境不支持独立演示窗口");
        return;
      }
      close();
      setError("");
      setFallbackUrl(null);
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
        setFallbackUrl(url.href);
        setError("浏览器拦截了观众窗口，可使用下方链接打开");
      } else session.current!.window = audience;
    },
  };
}
