import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useWebsiteNavigation } from "@app/routing/useWebsiteNavigation";

beforeEach(() => window.history.replaceState({}, "", "/home"));
afterEach(() => window.history.replaceState({}, "", "/home"));

test("defers navigation until the editor explicitly continues and preserves query state", () => {
  const { result } = renderHook(useWebsiteNavigation);
  let resume: (() => void) | undefined;
  act(() => {
    result.current.registerNavigationGuard((continuation) => {
      resume = continuation;
      return true;
    });
    result.current.navigatePath("/files?kind=audio");
  });
  expect(result.current.route.page).toBe("home");
  expect(window.location.pathname).toBe("/home");
  act(() => resume?.());
  expect(result.current.route).toMatchObject({
    page: "files",
    search: "?kind=audio",
  });
  expect(window.location.search).toBe("?kind=audio");
});

test("restores the current URL when browser history is intercepted", () => {
  const { result } = renderHook(useWebsiteNavigation);
  let resume: (() => void) | undefined;
  act(() => {
    result.current.navigatePath("/files?kind=image");
    result.current.registerNavigationGuard((continuation) => {
      resume = continuation;
      return true;
    });
  });
  act(() => {
    window.history.replaceState({}, "", "/tools");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(window.location.pathname + window.location.search).toBe(
    "/files?kind=image",
  );
  expect(result.current.route.page).toBe("files");
  act(() => resume?.());
  expect(result.current.route.page).toBe("tools");
  expect(window.location.pathname).toBe("/tools");
});

test("a cancelled agent open cannot complete a deferred navigation", () => {
  const { result } = renderHook(useWebsiteNavigation);
  let active = true;
  let resume: (() => void) | undefined;
  const opened = vi.fn();
  act(() => {
    result.current.registerNavigationGuard((continuation) => {
      resume = continuation;
      return true;
    });
    window.dispatchEvent(
      new CustomEvent("future-props:agent-open", {
        detail: { path: "/files", active: () => active, opened },
      }),
    );
  });
  active = false;
  act(() => resume?.());
  expect(opened).not.toHaveBeenCalled();
  expect(result.current.route.page).toBe("home");
});

test("listeners stop intercepting requests when their website unmounts", () => {
  const { result, unmount } = renderHook(useWebsiteNavigation);
  act(() => result.current.registerNavigationGuard(() => true));
  const before = new Event("future-props:development-query-refresh", {
    cancelable: true,
  });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  unmount();
  const after = new Event("future-props:development-query-refresh", {
    cancelable: true,
  });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  window.dispatchEvent(
    new CustomEvent("future-props:navigate", { detail: "/files" }),
  );
  expect(window.location.pathname).toBe("/home");
});

test("replaces a saved document identity without appending history or invoking the draft guard", () => {
  const { result } = renderHook(useWebsiteNavigation);
  const guard = vi.fn(() => true);
  const length = window.history.length;
  act(() => {
    result.current.registerNavigationGuard(guard);
    result.current.replaceRoute("thought-workshop-editor", "book", "note");
  });
  expect(window.history.length).toBe(length);
  expect(window.location.pathname).toBe(
    "/apps/thought-workshop/knowledge-bases/book/documents/note",
  );
  expect(result.current.route).toEqual({
    page: "thought-workshop-editor",
    projectId: "book",
    documentId: "note",
  });
  expect(guard).not.toHaveBeenCalled();
});
