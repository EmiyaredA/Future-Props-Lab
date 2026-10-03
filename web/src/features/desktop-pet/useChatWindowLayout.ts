import { useEffect, useState } from "react";

/** Resize the existing companion window without remounting its conversation. */
export function useChatWindowLayout(expanded: boolean) {
  const [side, setSide] = useState<"left" | "right">("left");
  useEffect(
    () =>
      window.futurePropsDesktop?.onPetChatLayout?.((value) =>
        setSide(value.side),
      ),
    [],
  );
  useEffect(() => {
    let alive = true;
    void window.futurePropsDesktop
      ?.setPetChatLayout?.(expanded ? "expanded" : "compact")
      .then((result) => {
        if (alive) setSide(result.side);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [expanded]);
  useEffect(() => {
    if (!window.futurePropsDesktop?.setPetChatInteractive) return;
    let interactive = true;
    const hit = (value: boolean) => {
      if (value === interactive) return;
      interactive = value;
      void window.futurePropsDesktop
        ?.setPetChatInteractive?.(value)
        .catch(() => undefined);
    };
    const move = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      hit(Boolean(target?.closest("[data-chat-surface]")));
    };
    const leave = () => hit(false);
    const focus = () => hit(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("mousemove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("focus", focus);
    };
  }, []);
  return side;
}
