import { useDocumentAccess } from "../DocumentAccess";
import { useEffect, useRef } from "react";
import {
  useAccountId,
  useAccountPermission,
} from "@platform/auth/AccountAccess";
import { getReading, recordReading } from "./api";

export function useReadingPosition(
  resourceId: string | undefined,
  title: string,
  revision: number | null = null,
  contentReady = true,
) {
  const access = useDocumentAccess();
  const root = useRef<HTMLElement | null>(null),
    user = useAccountId(),
    workspace = useAccountId();
  const canReadAccount = useAccountPermission("content.read");
  const local =
    access.community ||
    (!!resourceId?.startsWith("official/") && !canReadAccount);
  const latest = useRef({ title, revision });
  latest.current = { title, revision };
  const owner = useRef({ user, workspace, resourceId });
  owner.current = { user, workspace, resourceId };
  useEffect(() => {
    if (!contentReady || !resourceId || !user || !workspace || !root.current)
      return;
    const key = local ? `fpl-reading:${user}:${resourceId}` : null;
    const element = root.current;
    let scroller: HTMLElement | null = element;
    while (
      scroller &&
      scroller !== document.documentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    )
      scroller = scroller.parentElement;
    const target = scroller ?? document.documentElement;
    const eventTarget = target === document.documentElement ? window : target;
    let active = true,
      restoring = true,
      timer: number | undefined;
    const paragraphs = () =>
      Array.from(element.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,li"));
    const save = () => {
      if (
        !active ||
        restoring ||
        owner.current.user !== user ||
        owner.current.workspace !== workspace ||
        owner.current.resourceId !== resourceId
      )
        return;
      const top =
        target === document.documentElement
          ? 0
          : target.getBoundingClientRect().top;
      const paragraph = paragraphs().find(
        (node) => node.getBoundingClientRect().bottom > top,
      );
      const ratio =
        target.scrollTop /
        Math.max(1, target.scrollHeight - target.clientHeight);
      const position = {
        note_revision: latest.current.revision,
        paragraph: (paragraph?.textContent ?? "").slice(0, 240),
        ratio: Math.max(0, Math.min(1, ratio)),
      };
      if (key) {
        try {
          localStorage.setItem(key, JSON.stringify({ position }));
        } catch {
          /* Scroll restoration is optional when storage is unavailable. */
        }
      } else
        void recordReading(resourceId, latest.current.title, position).catch(
          () => {},
        );
    };
    const scroll = () => {
      if (restoring) return;
      clearTimeout(timer);
      timer = window.setTimeout(save, 1000);
    };
    const restore = window.setTimeout(
      () =>
        void (
          key
            ? Promise.resolve().then(
                () =>
                  JSON.parse(localStorage.getItem(key) ?? "null") as Awaited<
                    ReturnType<typeof getReading>
                  >,
              )
            : getReading(resourceId)
        )
          .then((reading) => {
            if (!active) return;
            if (
              reading &&
              !location.hash &&
              !new URLSearchParams(location.search).has("find")
            ) {
              const position = reading.position;
              // The ratio preserves the offset inside long blocks on the same revision.
              const sameRevision =
                position?.note_revision != null &&
                position.note_revision === latest.current.revision;
              const anchor = sameRevision
                ? undefined
                : paragraphs().find(
                    (node) =>
                      !!position?.paragraph &&
                      node.textContent?.slice(0, 240) === position.paragraph,
                  );
              if (anchor)
                target.scrollTop +=
                  anchor.getBoundingClientRect().top -
                  (target === document.documentElement
                    ? 0
                    : target.getBoundingClientRect().top);
              else
                target.scrollTop =
                  (position?.ratio ?? 0) *
                  Math.max(0, target.scrollHeight - target.clientHeight);
            }
          })
          .catch(() => {})
          .finally(() => {
            if (active) {
              restoring = false;
              save();
              eventTarget.addEventListener("scroll", scroll, { passive: true });
            }
          }),
      120,
    );
    return () => {
      save();
      active = false;
      clearTimeout(restore);
      clearTimeout(timer);
      eventTarget.removeEventListener("scroll", scroll);
    };
  }, [resourceId, user, workspace, contentReady, local]);
  return root;
}
