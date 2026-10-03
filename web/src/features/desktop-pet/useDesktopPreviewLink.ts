import { useCallback, useEffect, useRef, useState } from "react";
import type { PetPreviewDraft, PetPreviewIdentity } from "@platform/petPreview";
import type { PetDocument } from "./api";
import type { useEditorPreview } from "./useEditorPreview";

export function useDesktopPreviewLink(
  projectId: string,
  document: PetDocument | null,
  skinId: string | null,
  preview: ReturnType<typeof useEditorPreview>,
) {
  const bridge = window.futurePropsDesktop;
  const capable = Boolean(
    bridge?.beginPetPreview &&
    bridge.updatePetPreview &&
    bridge.endPetPreview &&
    bridge.onPetPreviewStatus,
  );
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState(
    capable
      ? "先将此角色放到桌面"
      : "当前环境仅支持中间预览，桌面联动需要新版桌面 App",
  );
  const session = useRef<PetPreviewIdentity | null>(null);
  const sequence = useRef(0);
  const sending = useRef(false);
  const queued = useRef(false);
  const latest = useRef({ document, skinId, preview });
  latest.current = { document, skinId, preview };
  const signature = JSON.stringify([
    document?.config,
    document?.revision,
    skinId,
    preview.eventName,
    preview.mode,
    preview.key,
    preview.line,
    preview.motionDemo,
  ]);
  const send = useCallback(async function sendLatest() {
    const owner = session.current;
    const current = latest.current;
    if (!owner || !current.document) return;
    if (sending.current) {
      queued.current = true;
      return;
    }
    sending.current = true;
    const config = current.document.config;
    const events = Object.fromEntries(
      Object.entries(config.events ?? {}).map(([name, reaction]) => [
        name,
        {
          motionId: reaction.motionId ?? null,
          expressionId: reaction.expressionId ?? null,
          lines: reaction.lines ?? [],
          sound: reaction.sound ?? "none",
        },
      ]),
    );
    const payload: PetPreviewDraft = {
      ...owner,
      baseRevision: current.document.revision,
      sequence: ++sequence.current,
      config: {
        schemaVersion: 2,
        skins: config.skins ?? [],
        activeSkinId: config.activeSkinId ?? null,
        schemeId: config.schemeId ?? null,
        events,
        habits: config.habits,
      },
      skinId: current.skinId,
      eventName: current.preview.eventName,
      mode: current.preview.mode,
      key: current.preview.key,
      line: current.preview.line,
      motionDemo: current.preview.motionDemo ?? null,
    };
    try {
      await window.futurePropsDesktop!.updatePetPreview!(payload);
    } catch (cause) {
      if (session.current === owner) {
        session.current = null;
        setEnabled(false);
        setMessage(
          cause instanceof Error
            ? cause.message
            : "桌面联动失败，中间预览仍可使用",
        );
        void window.futurePropsDesktop
          ?.endPetPreview?.(owner.sessionId)
          .catch(() => undefined);
      }
    } finally {
      sending.current = false;
      if (queued.current) {
        queued.current = false;
        void sendLatest();
      }
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const status = await window.futurePropsDesktop?.petStatus?.();
        if (alive) {
          const ready = Boolean(
            capable && status?.projectId === projectId && status.visible,
          );
          setAvailable(ready);
          setMessage((current) =>
            ["先将此角色放到桌面", "桌宠已打开，可开启临时联动"].includes(
              current,
            )
              ? ready
                ? "桌宠已打开，可开启临时联动"
                : "先将此角色放到桌面"
              : current,
          );
        }
      } catch {
        if (alive) setAvailable(false);
      }
    };
    void refresh();
    const poll = capable
      ? window.setInterval(() => void refresh(), 2000)
      : null;
    const off = window.futurePropsDesktop?.onPetPreviewStatus?.((status) => {
      if (!alive || status.sessionId !== session.current?.sessionId) return;
      setMessage(status.message);
      if (status.state === "idle" || status.state === "error") {
        session.current = null;
        setEnabled(false);
      }
    });
    return () => {
      alive = false;
      off?.();
      if (poll) window.clearInterval(poll);
      const owner = session.current;
      session.current = null;
      if (owner)
        void window.futurePropsDesktop
          ?.endPetPreview?.(owner.sessionId)
          .catch(() => undefined);
    };
  }, [projectId, capable]);
  useEffect(() => {
    if (enabled) void send();
  }, [enabled, signature, send]);
  useEffect(() => {
    if (!enabled) return;
    const heartbeat = window.setInterval(() => void send(), 2000);
    return () => window.clearInterval(heartbeat);
  }, [enabled, send]);
  const toggle = async () => {
    const owner = session.current;
    if (owner) {
      session.current = null;
      setEnabled(false);
      try {
        await window.futurePropsDesktop?.endPetPreview?.(owner.sessionId);
        setMessage("桌宠已恢复正常运行");
      } catch {
        setMessage("联动结束请求失败，断开后会自动恢复");
      }
      return;
    }
    if (!available || !latest.current.document) return;
    const identity = {
      projectId,
      sessionId: crypto.randomUUID(),
      baseRevision: latest.current.document.revision,
    };
    session.current = identity;
    try {
      const status =
        await window.futurePropsDesktop!.beginPetPreview!(identity);
      if (session.current !== identity) return;
      setMessage(status.message);
      setEnabled(true);
    } catch (cause) {
      if (session.current === identity) {
        session.current = null;
        setMessage(cause instanceof Error ? cause.message : "无法开启联动");
      }
    }
  };
  return { available, enabled, message, toggle };
}
