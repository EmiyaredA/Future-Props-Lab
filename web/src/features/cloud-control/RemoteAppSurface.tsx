import { useEffect, useRef, type RefObject } from "react";

const forwardedKeys = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowDown",
  "ArrowUp",
]);

function point(video: HTMLVideoElement, x: number, y: number) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const box = video.getBoundingClientRect();
  const maxScale = video.classList.contains("cloud-app-video-fit")
    ? Infinity
    : 1;
  const scale = Math.min(
    box.width / video.videoWidth,
    box.height / video.videoHeight,
    maxScale,
  );
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  const nx = (x - box.left - (box.width - width) / 2) / width;
  const ny = (y - box.top - (box.height - height) / 2) / height;
  return nx >= 0 && nx < 1 && ny >= 0 && ny < 1 ? { x: nx, y: ny } : null;
}

export function RemoteAppSurface({
  video,
  inputReady,
  fit,
  send,
  releaseFocus,
}: {
  video: RefObject<HTMLVideoElement | null>;
  inputReady: boolean;
  fit: boolean;
  send: (event: object, allowDrop?: boolean) => void;
  releaseFocus: () => void;
}) {
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const keys = useRef(new Set<string>());
  const pointer = useRef<number | undefined>(undefined);
  const lastMove = useRef(0);
  const clickCount = useRef({ count: 0, time: 0, x: 0, y: 0 });
  const wheelHandler = useRef<(event: WheelEvent) => void>(undefined);

  function release() {
    keys.current.clear();
    pointer.current = undefined;
    send({ type: "release" });
  }

  useEffect(() => {
    const element = video.current;
    const wheel = (event: WheelEvent) => wheelHandler.current?.(event);
    const blur = () => keyboard.current?.blur();
    element?.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", blur);
    return () => {
      element?.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", blur);
    };
  }, [video]);

  wheelHandler.current = (event) => {
    if (!inputReady || !video.current) return;
    const at = point(video.current, event.clientX, event.clientY);
    if (!at) return;
    event.preventDefault();
    const multiplier =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
    const delta = (value: number) =>
      Math.round(Math.max(-1500, Math.min(1500, value * multiplier)));
    send(
      {
        type: "scroll",
        ...at,
        dx: delta(event.deltaX),
        dy: delta(event.deltaY),
      },
      true,
    );
  };

  return (
    <>
      <video
        ref={video}
        className={`cloud-app-video${fit ? " cloud-app-video-fit" : ""}`}
        muted
        playsInline
        aria-label="远程应用画面"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (
            !inputReady ||
            pointer.current !== undefined ||
            (event.button !== 0 && event.button !== 2)
          )
            return;
          const at = point(event.currentTarget, event.clientX, event.clientY);
          if (!at) return;
          event.preventDefault();
          keyboard.current?.focus({ preventScroll: true });
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          const previous = clickCount.current;
          const now = performance.now();
          const count =
            event.button === 0 &&
            previous.count === 1 &&
            now - previous.time < 400 &&
            Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <
              5
              ? 2
              : 1;
          clickCount.current = {
            count,
            time: now,
            x: event.clientX,
            y: event.clientY,
          };
          send({ type: "down", button: event.button, ...at, clicks: count });
        }}
        onPointerMove={(event) => {
          if (
            !inputReady ||
            pointer.current !== event.pointerId ||
            performance.now() - lastMove.current < 16
          )
            return;
          const at = point(event.currentTarget, event.clientX, event.clientY);
          if (!at) return;
          lastMove.current = performance.now();
          send({ type: "move", ...at }, true);
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return;
          pointer.current = undefined;
          const at = point(event.currentTarget, event.clientX, event.clientY);
          if (at)
            send({
              type: "up",
              button: event.button,
              ...at,
              clicks: clickCount.current.count,
            });
          else release();
        }}
        onLostPointerCapture={(event) => {
          if (pointer.current === event.pointerId) release();
        }}
        onPointerCancel={release}
      />
      <textarea
        ref={keyboard}
        className="cloud-remote-keyboard"
        aria-label="应用键盘，按 Shift 加 Escape 释放焦点"
        autoComplete="off"
        tabIndex={inputReady ? 0 : -1}
        disabled={!inputReady}
        onBlur={release}
        onKeyDown={(event) => {
          if (event.shiftKey && event.key === "Escape") {
            event.preventDefault();
            releaseFocus();
            return;
          }
          if (event.nativeEvent.isComposing || event.key === "Process") return;
          if (!(
            event.metaKey ||
            event.ctrlKey ||
            forwardedKeys.has(event.code)
          ))
            return;
          if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) return;
          event.preventDefault();
          keys.current.add(event.code);
          send({
            type: "key",
            code: event.code,
            down: true,
            meta: event.metaKey,
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            alt: event.altKey,
          });
        }}
        onKeyUp={(event) => {
          if (!keys.current.delete(event.code)) return;
          event.preventDefault();
          send({
            type: "key",
            code: event.code,
            down: false,
            meta: event.metaKey,
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            alt: event.altKey,
          });
        }}
        onCompositionEnd={(event) => {
          if (event.data) send({ type: "text", text: event.data });
          event.currentTarget.value = "";
        }}
        onInput={(event) => {
          const native = event.nativeEvent as InputEvent;
          if (
            native.isComposing ||
            native.inputType === "insertCompositionText" ||
            native.inputType === "insertFromComposition"
          )
            return;
          if (native.inputType === "insertText" && native.data)
            send({ type: "text", text: native.data });
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}
