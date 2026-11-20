import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createApp, h, shallowRef } from "vue";
import { VueFlow, type VueFlowStore } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import type { Viewport } from "./geometry";

export function ToonflowCanvas({
  viewport,
  children,
}: {
  viewport: Viewport;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const flow = useRef<VueFlowStore | null>(null);
  const next = useRef(viewport);
  next.current = viewport;
  const [world, setWorld] = useState<HTMLElement>();

  useLayoutEffect(() => {
    if (!root.current) return;
    const first = shallowRef(next.current);
    const app = createApp({
      setup: () => () =>
        h(
          VueFlow,
          {
            defaultViewport: first.value,
            minZoom: 0.01,
            maxZoom: 8,
            panOnDrag: false,
            panOnScroll: false,
            zoomOnScroll: false,
            zoomOnPinch: false,
            zoomOnDoubleClick: false,
            panActivationKeyCode: null,
            zoomActivationKeyCode: null,
            selectionKeyCode: null,
            deleteKeyCode: null,
            nodesDraggable: false,
            nodesConnectable: false,
            elementsSelectable: false,
            preventScrolling: false,
            onInit: (store: VueFlowStore) => {
              flow.current = store;
              void store.setViewport(next.current);
            },
          },
          {
            "zoom-pane": () =>
              h("div", {
                class: "visual-canvas-world",
                ref: (element: unknown) =>
                  setWorld(
                    element instanceof HTMLElement ? element : undefined,
                  ),
              }),
          },
        ),
    });
    app.mount(root.current);
    return () => {
      flow.current = null;
      app.unmount();
    };
  }, []);

  useLayoutEffect(() => {
    void flow.current?.setViewport(viewport);
  }, [viewport]);

  return (
    <div ref={root} className="visual-toonflow-canvas">
      {world && createPortal(children, world)}
    </div>
  );
}
