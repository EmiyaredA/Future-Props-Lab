import { useEffect, useRef } from "react";
import "./source.css";

type SourceContext = {
  path: string;
  title: string;
  application: string;
  projectId?: string;
  selection?: { id: string; name: string; value: string };
  unsaved?: boolean;
};

function selectable(element: Element | null): HTMLElement | null {
  let node = element;
  while (node && node !== document.body) {
    if (
      node instanceof HTMLElement &&
      (node.dataset.amadeusName ||
        node.dataset.blockId ||
        node.dataset.nodeId ||
        node.matches(
          "button,input,textarea,[role=button],[role=slider],[role=tab]",
        ))
    )
      return node;
    node = node.parentElement;
  }
  return null;
}

function description(element: HTMLElement) {
  const input = element instanceof HTMLInputElement ? element : null;
  const safeInput = input?.type === "range" || input?.type === "number";
  return {
    id: (
      element.dataset.amadeusId ||
      element.dataset.blockId ||
      element.dataset.nodeId ||
      element.id ||
      element.getAttribute("aria-label") ||
      "control"
    ).slice(0, 120),
    name: (
      element.dataset.amadeusName ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent ||
      element.tagName
    )
      .trim()
      .slice(0, 200),
    value: (
      element.dataset.amadeusValue ||
      (safeInput ? input?.value : "") ||
      ""
    ).slice(0, 2000),
  };
}

export function AmadeusSourceHost() {
  const current = useRef<SourceContext>({
    path: location.pathname,
    title: document.title,
    application: "应用首页",
  });
  useEffect(() => {
    const bridge = window.futurePropsDesktop;
    if (
      !bridge?.publishAmadeusContext ||
      !bridge.onAmadeusPickCommand ||
      !bridge.addAmadeusReference
    )
      return;
    let picking = false;
    let pickIndex = 1;
    let target: HTMLElement | null = null;
    const outline = document.createElement("div");
    outline.className = "amadeus-picker-outline";
    const label = document.createElement("div");
    label.className = "amadeus-picker-label";
    const tip = document.createElement("div");
    tip.className = "amadeus-picker-tip";
    tip.textContent = "点击添加 · Esc 退出";
    document.body.append(outline, label, tip);
    const draw = () => {
      if (!picking || !target) {
        outline.hidden = true;
        label.hidden = true;
        return;
      }
      const rect = target.getBoundingClientRect();
      Object.assign(outline.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      Object.assign(label.style, {
        left: `${rect.x}px`,
        top: `${Math.max(0, rect.y - 28)}px`,
      });
      label.textContent = `${pickIndex}. ${description(target).name}`;
      outline.hidden = false;
      label.hidden = false;
    };
    const stop = () => {
      picking = false;
      target = null;
      tip.hidden = true;
      draw();
    };
    const unsubscribe = bridge.onAmadeusPickCommand((value) => {
      picking = value.enabled;
      pickIndex = value.index;
      tip.hidden = !value.enabled;
      target = null;
      draw();
    });
    const locate = bridge.onAmadeusLocate?.((value) => {
      const id = (value as { id?: string }).id;
      const element =
        [
          ...document.querySelectorAll<HTMLElement>(
            "[data-amadeus-id],[data-block-id],[data-node-id]",
          ),
        ].find(
          (candidate) =>
            candidate.dataset.amadeusId === id ||
            candidate.dataset.blockId === id ||
            candidate.dataset.nodeId === id,
        ) || (id ? document.getElementById(id) : null);
      if (!element) return;
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
      element.classList.add("amadeus-located");
      window.setTimeout(
        () => element.classList.remove("amadeus-located"),
        2200,
      );
    });
    const context = (event: Event) => {
      const detail = (event as CustomEvent<SourceContext>).detail;
      const changedSource =
        (detail.path !== undefined && detail.path !== current.current.path) ||
        ("projectId" in detail &&
          detail.projectId !== current.current.projectId);
      current.current = {
        ...current.current,
        ...(changedSource ? { selection: undefined, unsaved: false } : {}),
        ...detail,
      };
      void bridge.publishAmadeusContext?.(current.current);
    };
    let conflictBanner: HTMLElement | null = null;
    const mutation = bridge.onAmadeusMutation?.((value) => {
      const changed = value as { application?: string; projectId?: string };
      if (
        changed.application !== "*" ||
        (changed.projectId && changed.projectId !== current.current.projectId)
      )
        return;
      if (!current.current.unsaved) {
        window.location.reload();
        return;
      }
      if (conflictBanner) return;
      const banner = document.createElement("div");
      banner.className = "amadeus-mutation-banner";
      banner.setAttribute("role", "alert");
      banner.textContent =
        "Amadeus 已更新项目；此窗口有未保存编辑，请先处理冲突再刷新。";
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "关闭提示";
      dismiss.addEventListener("click", () => {
        banner.remove();
        conflictBanner = null;
      });
      banner.append(dismiss);
      document.body.append(banner);
      conflictBanner = banner;
    });
    const move = (event: MouseEvent) => {
      if (!picking) return;
      target = selectable(
        event.target instanceof Element ? event.target : null,
      );
      draw();
    };
    const click = (event: MouseEvent) => {
      if (!picking) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      target =
        selectable(event.target instanceof Element ? event.target : null) ||
        target;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const item = description(target);
      void bridge.addAmadeusReference?.({
        ...item,
        application: current.current.application,
        source: current.current.path,
        rect: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: Math.min(rect.width, 900),
          height: Math.min(rect.height, 700),
        },
      });
      stop();
    };
    const block = (event: Event) => {
      if (!picking) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const key = (event: KeyboardEvent) => {
      if (picking && event.key === "Escape") {
        event.preventDefault();
        stop();
      }
    };
    tip.hidden = true;
    window.addEventListener("future-props:amadeus-context", context);
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    for (const type of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "dblclick",
      "contextmenu",
    ])
      document.addEventListener(type, block, true);
    document.addEventListener("keydown", key, true);
    return () => {
      unsubscribe();
      locate?.();
      mutation?.();
      conflictBanner?.remove();
      outline.remove();
      label.remove();
      tip.remove();
      window.removeEventListener("future-props:amadeus-context", context);
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      for (const type of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "dblclick",
        "contextmenu",
      ])
        document.removeEventListener(type, block, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  return null;
}
