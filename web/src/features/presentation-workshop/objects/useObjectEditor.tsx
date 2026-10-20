import { lazy, Suspense, useRef, useState } from "react";
import type { Draft, SlideElement } from "../types";
import { objectLabels, type ObjectKind } from "./objectDefaults";

const ObjectDialog = lazy(() => import("./ObjectDialog"));
type Request = { kind: ObjectKind; slideId: string; initial?: SlideElement };
export function useObjectEditor({
  slideId,
  readOnly,
  current,
  commit,
  select,
}: {
  slideId: string;
  readOnly: boolean;
  current: () => Draft;
  commit: (update: (draft: Draft) => Draft) => void;
  select: (ids: string[]) => void;
}) {
  const [request, setRequest] = useState<Request | null>(null);
  const allowed = useRef({ slideId, readOnly });
  allowed.current = { slideId, readOnly };
  const open = (kind: ObjectKind, initial?: SlideElement) => {
    if (!readOnly) setRequest({ slideId, kind, initial });
  };
  return {
    actions: (
      ["table", "chart", "formula", "video", "audio"] as ObjectKind[]
    ).map((kind) => ({
      label: `插入${objectLabels[kind]}`,
      onSelect: () => open(kind),
    })),
    edit: (element: SlideElement) => {
      if (element.kind in objectLabels && !element.locked)
        open(element.kind as ObjectKind, element);
    },
    dialog:
      request && request.slideId === slideId && !readOnly ? (
        <Suspense fallback={<p role="status">正在加载内容编辑…</p>}>
          <ObjectDialog
            key={`${request.slideId}:${request.initial?.id ?? request.kind}`}
            kind={request.kind}
            initial={request.initial}
            onClose={() => setRequest(null)}
            onApply={(element) => {
              if (
                allowed.current.readOnly ||
                allowed.current.slideId !== request.slideId
              )
                return;
              const slide = current().document.slides.find(
                (s) => s.id === request.slideId,
              );
              const existing = slide?.elements.find((e) => e.id === element.id);
              if (
                !slide ||
                (request.initial &&
                  (!existing ||
                    JSON.stringify(existing) !==
                      JSON.stringify(request.initial)))
              )
                throw new Error("内容已发生变化，请重新打开编辑");
              if (!existing && slide.elements.length >= 200)
                throw new Error("每页最多 200 个元素");
              commit((draft) => ({
                ...draft,
                document: {
                  ...draft.document,
                  version: 3,
                  slides: draft.document.slides.map((s) =>
                    s.id === request.slideId
                      ? {
                          ...s,
                          elements: existing
                            ? s.elements.map((e) =>
                                e.id === element.id ? element : e,
                              )
                            : [...s.elements, element],
                        }
                      : s,
                  ),
                },
              }));
              select([element.id]);
            }}
          />
        </Suspense>
      ) : null,
  };
}
