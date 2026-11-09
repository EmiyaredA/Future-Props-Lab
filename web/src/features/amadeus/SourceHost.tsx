import { workshopProjects } from "./projectScope";
import { refreshAmadeusProject } from "@platform/assistant";
import { useEffect, useRef } from "react";
import { NAVIGATION_COMMITTED } from "@shared/ui/navigationGuards";
import "./source.css";
import { useAmadeusBridge } from "./PageContext";
import { elementReference } from "./elementReferences";
import type { Reference } from "./protocol";

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
  const bridge = useAmadeusBridge();
  const current = useRef<SourceContext>({
    path: location.pathname,
    title: document.title,
    application: "应用首页",
  });
  useEffect(() => {
    let picking = false;
    let pickIndex = 1;
    let target: {
      anchor: Element;
      reference: Reference;
      point?: { x: number; y: number };
    } | null = null;
    const outline = document.createElement("div");
    outline.className = "amadeus-picker-outline";
    const label = document.createElement("div");
    label.className = "amadeus-picker-label";
    const tip = document.createElement("div");
    tip.className = "amadeus-picker-tip";
    tip.setAttribute("role", "status");
    tip.textContent = "点击元素添加 · Esc 退出";
    document.body.append(outline, label, tip);
    const draw = () => {
      if (!picking || !target) {
        outline.hidden = true;
        label.hidden = true;
        return;
      }
      const rect = target.point
        ? new DOMRect(target.point.x - 9, target.point.y - 9, 18, 18)
        : target.anchor.getBoundingClientRect();
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
      label.textContent = `${pickIndex}. ${target.reference.name}`;
      outline.hidden = false;
      label.hidden = false;
    };
    const stop = () => {
      if (picking) void bridge.finishAmadeusPick?.();
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
    let highlighted: HTMLElement | undefined;
    let clearHighlightTimer: number | undefined;
    const clearHighlight = () => {
      window.clearTimeout(clearHighlightTimer);
      highlighted?.classList.remove("amadeus-located");
      highlighted = undefined;
    };
    const locate = bridge.onAmadeusLocate(async (value) => {
      const { target: destination, id, source } = value;
      if (destination) {
        const editor = bridge.currentElementSource();
        if (
          !editor ||
          editor.resource !== destination.project_resource ||
          editor.projectId !== destination.project_id
        )
          return "wrong-project";
        if (editor.locate) {
          const result = editor.locate(destination);
          if (result !== true)
            return result === "failed" ? "failed" : "missing";
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const currentEditor = bridge.currentElementSource();
          if (
            currentEditor?.resource !== destination.project_resource ||
            currentEditor.projectId !== destination.project_id
          )
            return "wrong-project";
        } else if (
          !editor.resolve(
            destination.element_id,
            destination.element_kind,
            destination.parent_id ?? undefined,
          )
        ) {
          return "missing";
        }
      } else if (source?.startsWith("/") && source !== location.pathname)
        return "wrong-project";

      const candidates = document.querySelectorAll<HTMLElement>(
        ".website-page [data-amadeus-id], .website-page [data-block-id], .website-page [data-node-id]",
      );
      const element =
        [...candidates].find((candidate) => {
          const elementId =
            candidate.dataset.amadeusId ||
            candidate.dataset.blockId ||
            candidate.dataset.nodeId;
          return (
            elementId === (destination?.element_id ?? id) &&
            (!destination?.parent_id ||
              !candidate.dataset.amadeusParent ||
              candidate.dataset.amadeusParent === destination.parent_id) &&
            (!destination ||
              !candidate.dataset.amadeusKind ||
              candidate.dataset.amadeusKind === destination.element_kind) &&
            candidate.getClientRects().length > 0
          );
        }) || (!destination ? document.getElementById(id) : null);
      if (!element)
        return destination && bridge.currentElementSource()?.locate
          ? "found"
          : "missing";
      clearHighlight();
      highlighted = element;
      element.classList.add("amadeus-located");
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
      clearHighlightTimer = window.setTimeout(clearHighlight, 2200);
      return "found";
    });
    const publishContext = (detail: Partial<SourceContext>) => {
      const path = detail.path ?? location.pathname;
      const changedPath = path !== current.current.path;
      const changedSource =
        changedPath ||
        ("projectId" in detail &&
          detail.projectId !== current.current.projectId);
      if (changedSource) stop();
      current.current = {
        ...current.current,
        ...(changedPath ? { projectId: undefined } : {}),
        ...(changedSource ? { title: document.title } : {}),
        ...(changedSource ? { selection: undefined, unsaved: false } : {}),
        ...detail,
        path,
      };
      void bridge.publishAmadeusContext?.(current.current);
    };
    const context = (event: Event) =>
      publishContext((event as CustomEvent<Partial<SourceContext>>).detail);
    let conflictBanner: HTMLElement | null = null;
    const navigated = () => {
      conflictBanner?.remove();
      conflictBanner = null;
      publishContext({ path: location.pathname });
    };
    let mounted = true;
    const mutation = bridge.onAmadeusMutation(
      ({ resource, projectId, elementId }) => {
        const path = location.pathname;
        const editor = bridge.currentElementSource();
        const currentProject = editor?.projectId ?? current.current.projectId;
        const currentResource =
          editor?.resource ??
          workshopProjects.find((item) => path.split("/")[2] === item.app)
            ?.resource;
        const sameElement = Boolean(
          elementId &&
          (path.split("/").includes(elementId) ||
            editor?.selected().some((element) => element.id === elementId)),
        );
        if (
          currentResource !== resource ||
          (currentProject && currentProject !== projectId && !sameElement)
        )
          return;
        const refresh = projectId
          ? refreshAmadeusProject({ resource, projectId })
          : undefined;

        const showNotice = (message: string) => {
          if (!mounted || location.pathname !== path) return;
          conflictBanner?.remove();
          const banner = document.createElement("div");
          banner.className = "amadeus-mutation-banner";
          banner.setAttribute("role", "status");
          const link = document.createElement("a");
          link.href = window.location.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "在新标签页查看最新内容";
          const dismiss = document.createElement("button");
          dismiss.type = "button";
          dismiss.textContent = "关闭提示";
          dismiss.addEventListener("click", () => {
            banner.remove();
            conflictBanner = null;
          });
          banner.append(message, link, dismiss);
          document.body.append(banner);
          conflictBanner = banner;
        };
        if (!refresh) {
          showNotice("Amadeus 已更新项目。");
          return;
        }
        void refresh.then(
          (result) => {
            if (result === "dirty")
              showNotice("Amadeus 已更新项目；当前页面有未保存的编辑。");
          },
          () => showNotice("操作已执行，但此页面暂时无法读取最新项目数据。"),
        );
      },
    );
    const identify = (event: MouseEvent) => {
      const origin = event.target instanceof Element ? event.target : null;
      if (!origin?.closest(".website-page")) return null;
      const editor = bridge.currentElementSource();
      if (editor) {
        const path = event
          .composedPath()
          .filter((node): node is HTMLElement => node instanceof HTMLElement);
        const mark = path.find((node) =>
          node.matches("[data-amadeus-id], [data-block-id]"),
        );
        const elementId = mark?.dataset.amadeusId ?? mark?.dataset.blockId;
        const control = path.find((node) =>
          node.matches("button,input,textarea,select,a,[role=button]"),
        );
        if (control && (!mark || path.indexOf(control) < path.indexOf(mark)))
          return null;
        const item = elementId
          ? editor.resolve(
              elementId,
              mark?.dataset.amadeusKind,
              mark?.dataset.amadeusParent,
            )
          : editor.hitTest?.(event);
        return item
          ? {
              anchor: mark ?? origin,
              reference: elementReference(editor, item),
              point: mark ? undefined : { x: event.clientX, y: event.clientY },
            }
          : null;
      }
      if (current.current.projectId) return null;
      const anchor = selectable(origin);
      return anchor
        ? {
            anchor,
            reference: {
              ...description(anchor),
              application: current.current.application,
              source: current.current.path,
            },
          }
        : null;
    };
    const move = (event: MouseEvent) => {
      if (!picking) return;
      target = identify(event);
      draw();
    };
    const click = (event: MouseEvent) => {
      if (
        !picking ||
        (event.target instanceof Element &&
          event.target.closest(".website-assistant"))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      target = identify(event);
      if (!target) return;
      void bridge.addAmadeusReference(target.reference);
      stop();
    };
    const block = (event: Event) => {
      if (
        !picking ||
        (event.target instanceof Element &&
          event.target.closest(".website-assistant"))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const key = (event: KeyboardEvent) => {
      if (picking && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        stop();
      }
    };
    tip.hidden = true;
    window.addEventListener("future-props:amadeus-context", context);
    window.addEventListener(NAVIGATION_COMMITTED, navigated);
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
      mounted = false;
      mutation();
      conflictBanner?.remove();
      clearHighlight();
      outline.remove();
      label.remove();
      tip.remove();
      window.removeEventListener("future-props:amadeus-context", context);
      window.removeEventListener(NAVIGATION_COMMITTED, navigated);
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
  }, [bridge]);
  return null;
}
