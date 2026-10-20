import type { AudienceOverlay } from "./useAudience";
import { useEffect, useState } from "react";
import {
  AUTH_REQUIRED_EVENT,
  WORKSPACE_CHANGED_EVENT,
} from "@platform/api/studioAuth";
import { getProject } from "../api";
import { PresentationShow } from "../PresentationShow";
import type { Deck } from "../types";

export function Audience({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId: string;
}) {
  const [snapshot, setSnapshot] = useState<{
      deck: Deck;
      index: number;
      step: number;
      overlay?: AudienceOverlay;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (
      !/^[0-9a-f-]{36}$/.test(sessionId) ||
      typeof BroadcastChannel === "undefined"
    ) {
      setError("演示会话无效");
      return;
    }
    const channel = new BroadcastChannel(`fpl-presentation-${sessionId}`),
      controller = new AbortController();
    let alive = true,
      authorized = false,
      last = Date.now();
    const close = () => {
      if (!alive) return;
      alive = false;
      setSnapshot(null);
      setError("演示已结束");
      channel.close();
    };
    void getProject(projectId, controller.signal)
      .then(() => {
        if (alive) {
          authorized = true;
          channel.postMessage({ type: "ready" });
        }
      })
      .catch(() => {
        if (alive) {
          close();
          setError("无法访问演示文稿");
        }
      });
    channel.onmessage = (event) => {
      if (!alive || !authorized) return;
      const data = event.data;
      if (data?.type === "close") {
        close();
        return;
      }
      if (
        data?.type === "snapshot" &&
        data.projectId === projectId &&
        data.deck?.slides?.length &&
        data.deck.slides.length <= 100
      ) {
        last = Date.now();
        setSnapshot({
          deck: data.deck,
          index: Math.max(
            0,
            Math.min(data.deck.slides.length - 1, Number(data.index) || 0),
          ),
          step: Math.max(0, Number(data.step) || 0),
          overlay: data.overlay,
        });
      } else if (data?.type === "overlay") {
        if (
          data.overlay &&
          Array.isArray(data.overlay.marks) &&
          data.overlay.marks.length <= 500
        )
          setSnapshot((current) =>
            current ? { ...current, overlay: data.overlay } : null,
          );
      } else if (
        data?.type === "position" &&
        Number.isInteger(data.index) &&
        Number.isInteger(data.step)
      ) {
        last = Date.now();
        setSnapshot((current) =>
          current
            ? {
                ...current,
                index: Math.max(
                  0,
                  Math.min(current.deck.slides.length - 1, data.index),
                ),
                step: Math.max(0, data.step),
              }
            : null,
        );
      }
    };
    const timer = setInterval(() => {
      if (Date.now() - last > 8000) close();
    }, 2000);
    window.addEventListener(AUTH_REQUIRED_EVENT, close);
    window.addEventListener(WORKSPACE_CHANGED_EVENT, close);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      channel.close();
      window.removeEventListener(AUTH_REQUIRED_EVENT, close);
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, close);
    };
  }, [sessionId, projectId]);
  return snapshot ? (
    <PresentationShow
      deck={snapshot.deck}
      start={snapshot.index}
      position={{ index: snapshot.index, step: snapshot.step }}
      overlay={snapshot.overlay}
      projectId={projectId}
      onClose={() => window.close()}
    />
  ) : (
    <div className="presentation-audience-status" role="status">
      {error || "正在连接演示者…"}
    </div>
  );
}
