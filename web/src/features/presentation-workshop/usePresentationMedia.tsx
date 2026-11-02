import { useTransferProgress } from "@platform/api/useTransferProgress";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { imageBlob, uploadImage, previewSvg } from "./api";
import { newElement } from "./templates";
import { PresentationImages } from "./PresentationImages";
import { presentationKeys } from "./queryKeys";
import type { Draft } from "./types";

type Request = {
  slideId: string;
  elementId?: string;
  assetId?: string | null;
  tab: string;
  file?: File;
};
export function usePresentationMedia({
  slideId,
  selected,
  current,
  commit,
  select,
  readOnly,
}: {
  slideId: string;
  selected: string[];
  current: () => Draft;
  commit: (change: (d: Draft) => Draft) => void;
  select: (ids: string[]) => void;
  readOnly: boolean;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const cache = useQueryClient(),
    [request, setRequest] = useState<Request | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const token = useRef(0),
    active = useRef(slideId);
  const permission = useRef(readOnly);
  permission.current = readOnly;
  useEffect(() => {
    if (readOnly) {
      token.current++;
      setRequest(null);
      setBusy(false);
    }
  }, [readOnly]);
  useEffect(() => {
    const counter = token;
    return () => {
      counter.current++;
    };
  }, []);
  active.current = slideId;
  const close = () => {
    token.current++;
    setRequest(null);
    setBusy(false);
  };
  const open = (tab = "文件库", replace = false, file?: File) => {
    if (readOnly) return;
    const element = current()
      .document.slides.find((s) => s.id === slideId)
      ?.elements.find((e) => e.id === selected[0]);
    if (replace && (!element || element.locked)) return;
    setError("");
    setRequest({
      slideId,
      tab,
      file,
      ...(replace
        ? { elementId: element!.id, assetId: element!.asset_id }
        : {}),
    });
  };
  const apply = async (
    id: string,
    file: Blob,
    target: Request,
    version: number,
  ) => {
    const vector = file.type === "image/svg+xml";
    let width: number, height: number;
    if (vector) {
      const meta = await previewSvg(await file.text());
      width = meta.width;
      height = meta.height;
    } else {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    }
    if (version !== token.current || permission.current) return;
    const factor = Math.min(480 / width, 600 / height),
      element = newElement(vector ? "vector" : "image", {
        asset_id: id,
        width: Math.max(1, width * factor),
        height: Math.max(1, height * factor),
      });
    commit((d) => {
      const page = d.document.slides.find((s) => s.id === target.slideId);
      if (!page) throw new Error("目标页面已删除，请重新选择");
      const old = page.elements.find((e) => e.id === target.elementId);
      if (
        target.elementId &&
        (!old || old.locked || old.asset_id !== target.assetId)
      )
        throw new Error("所选元素已更改或锁定，请重新选择");
      if (!target.elementId && page.elements.length >= 200)
        throw new Error("每页最多 200 个元素");
      return {
        ...d,
        document: {
          ...d.document,
          slides: d.document.slides.map((s) =>
            s.id !== page.id
              ? s
              : {
                  ...s,
                  elements: target.elementId
                    ? s.elements.map((e) =>
                        e.id === target.elementId
                          ? {
                              ...e,
                              kind: element.kind,
                              asset_id: id,
                              crop: { left: 0, right: 0, top: 0, bottom: 0 },
                              vector_color: null,
                            }
                          : e,
                      )
                    : [...s.elements, element],
                },
          ),
        },
      };
    });
    if (active.current === target.slideId)
      select([target.elementId ?? element.id]);
    close();
  };
  const execute = async (
    load: () => Promise<{ id: string; file: Blob }>,
    target = request,
  ) => {
    if (!target || readOnly || busy) return;
    const version = ++token.current;
    setBusy(true);
    setError("");
    try {
      const { id, file } = await load();
      await cache.invalidateQueries({ queryKey: presentationKeys.images });
      await apply(id, file, target, version);
    } catch (e) {
      if (version === token.current)
        setError(e instanceof Error ? e.message : "素材处理失败");
    } finally {
      if (version === token.current) setBusy(false);
    }
  };
  const upload = (file: File) =>
    execute(async () => ({
      id: (await runTransfer((onProgress) => uploadImage(file, { onProgress })))
        .id,
      file,
    }));
  const icon = (svg: string, name: string) => {
    if (readOnly) return;
    const target = { slideId, tab: "SVG" };
    setRequest(target);
    void execute(async () => {
      const result = await previewSvg(svg);
      const file = new File([result.svg], `${name}.svg`, {
        type: "image/svg+xml",
      });
      return {
        id: (
          await runTransfer((onProgress) => uploadImage(file, { onProgress }))
        ).id,
        file,
      };
    }, target);
  };
  return {
    transferProgress: activeTransferProgress,
    open,
    icon,
    isOpen: !!request,
    dialog: request ? (
      <PresentationImages
        key={`${request.slideId}:${request.elementId ?? "insert"}:${request.tab}`}
        initialTab={request.tab}
        initialFile={request.file}
        busy={busy}
        error={error}
        onClose={close}
        onChoose={(id) =>
          void execute(async () => ({
            id,
            file: await runTransfer((onProgress) =>
              imageBlob(id, { onProgress }),
            ),
          }))
        }
        onUpload={upload}
      />
    ) : null,
  };
}
