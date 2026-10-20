import type { HTMLAttributes } from "react";
import { defaultRun, newElement, newId } from "../templates";
import { cloneFragment } from "../scene/model";
import type { PresentationSession } from "./usePresentationSession";

export const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest(
    "input,textarea,[contenteditable=true],[role=dialog],[role=alertdialog],[role=menu],[role=menuitem]",
  );
export function useEditorBindings(
  session: PresentationSession,
  readOnly: boolean,
): HTMLAttributes<HTMLDivElement> {
  const {
    history,
    commands,
    slide,
    selected,
    select,
    editing,
    setEditing,
    scene,
    media,
    previewId,
    cropSession,
    show,
    clipboard,
    insert,
    insertFragment,
  } = session;
  return {
    ...history.bindings,
    onKeyDownCapture: (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f" &&
        !event.nativeEvent.isComposing &&
        !(event.target as Element).closest(
          '[data-presentation-history="local"]',
        )
      ) {
        event.preventDefault();
        session.setSearchOpen(true);
        return;
      }
      history.keyDown(event);
      if (
        !event.defaultPrevented &&
        !event.nativeEvent.isComposing &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        event.stopPropagation();
        commands.run("save");
      }
    },
    onKeyDown: (event) => {
      if (
        event.defaultPrevented ||
        readOnly ||
        event.nativeEvent.isComposing ||
        editableTarget(event.target) ||
        media.isOpen ||
        previewId ||
        cropSession ||
        show !== null
      )
        return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && ["a", "d"].includes(key)) {
        event.preventDefault();
        commands.run(key === "a" ? "selectAll" : "duplicate");
      }
      if (["Delete", "Backspace"].includes(event.key)) {
        event.preventDefault();
        commands.run("remove");
      }
      if (event.key === "Escape") {
        if (editing) setEditing(null);
        else if (scene.connectionOpen) {
          scene.closeConnection();
          event.currentTarget
            .querySelector<HTMLElement>(".presentation-canvas")
            ?.focus();
        } else if (scene.scope) scene.exitGroup();
        else select([]);
      }
      const arrows = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      } as const;
      if (event.key in arrows && selected.length) {
        event.preventDefault();
        commands.run(
          arrows[event.key as keyof typeof arrows],
          event.shiftKey ? 10 : 1,
        );
      }
    },
    onCopy: (event) => {
      if (editableTarget(event.target)) return;
      const elements = slide.elements.filter((e) => selected.includes(e.id));
      if (!elements.length) return;
      const token = newId();
      clipboard.current = {
        token,
        fragment: cloneFragment(
          slide,
          elements.map((e) => e.id),
          newId,
          0,
        ),
      };
      event.preventDefault();
      event.clipboardData.setData("application/x-fpl-presentation", token);
      event.clipboardData.setData(
        "text/plain",
        elements
          .flatMap((e) =>
            e.paragraphs.flatMap((p) => p.runs.map((r) => r.text)),
          )
          .join("\n"),
      );
    },
    onPaste: (event) => {
      if (readOnly || editableTarget(event.target)) return;
      if (
        clipboard.current &&
        event.clipboardData.getData("application/x-fpl-presentation") ===
          clipboard.current.token
      ) {
        event.preventDefault();
        insertFragment(
          cloneFragment(
            { ...slide, ...clipboard.current.fragment },
            clipboard.current.fragment.elements.map((e) => e.id),
            newId,
          ),
        );
        return;
      }
      const file = Array.from(event.clipboardData.files).find((file) =>
        file.type.startsWith("image/"),
      );
      if (file) {
        event.preventDefault();
        media.open(
          file.type === "image/svg+xml" ? "SVG" : "上传图片",
          false,
          file,
        );
        return;
      }
      const text = event.clipboardData.getData("text/plain");
      if (text) {
        event.preventDefault();
        insert([
          newElement("text", {
            paragraphs: [
              {
                align: "left",
                line_height: 1.3,
                bullet: false,
                numbered: false,
                runs: [defaultRun(text.slice(0, 20000))],
              },
            ],
          }),
        ]);
      }
    },
  };
}
