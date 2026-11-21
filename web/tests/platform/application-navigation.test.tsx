import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { lazy, Suspense, useState, type ReactElement } from "react";
import { useApplicationNavigation } from "@app/routing/useApplicationNavigation";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { useUnsavedNavigation } from "@shared/ui/useUnsavedNavigation";
import { NAVIGATION_COMMITTED } from "@shared/ui/navigationGuards";

const ownsPath = (path: string) => path.startsWith("/apps/visual-workshop");
const home = "/apps/visual-workshop";
const assets = home + "/assets?kind=image#library";

function Workspace() {
  const { path, navigate } = useApplicationNavigation("visual", ownsPath);
  const [draft, setDraft] = useState("");
  const protection = useUnsavedNavigation({
    dirty: Boolean(draft),
    busy: false,
    title: "未保存草稿",
    description: "离开前确认。",
  });
  return (
    <>
      <output aria-label="路径">{path}</output>
      <input
        aria-label="草稿"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button onClick={() => navigate(assets)}>素材</button>
      <button onClick={() => navigate(home)}>项目</button>
      <button onClick={() => navigate("/apps")}>其他应用</button>
      <a href={assets}>任务链接</a>
      <a href={assets} target="_blank">
        新窗口
      </a>
      <a href={assets} download>
        下载
      </a>
      {protection.dialog}
    </>
  );
}

beforeEach(() => history.replaceState({ existing: "preserved" }, "", home));
afterEach(() => history.replaceState({}, "", "/home"));

test("switches routes in the same document, preserving mounted state and query/hash", () => {
  const navigated = vi.fn();
  window.addEventListener(NAVIGATION_COMMITTED, navigated);
  const view = render(
    <NavigationProtection>
      <Workspace />
    </NavigationProtection>,
  );
  const input = screen.getByRole("textbox");
  fireEvent.click(screen.getByRole("button", { name: "素材" }));
  expect(screen.getByLabelText("路径")).toHaveTextContent(assets);
  expect(location.pathname + location.search + location.hash).toBe(assets);
  expect(screen.getByRole("textbox")).toBe(input);
  expect(history.state.existing).toBe("preserved");
  const length = history.length;
  fireEvent.click(screen.getByRole("button", { name: "素材" }));
  expect(history.length).toBe(length);
  expect(navigated).toHaveBeenCalledOnce();
  view.unmount();
  window.removeEventListener(NAVIGATION_COMMITTED, navigated);
});

test("Back and Forward use the existing history entries", async () => {
  render(
    <NavigationProtection>
      <Workspace />
    </NavigationProtection>,
  );
  fireEvent.click(screen.getByRole("button", { name: "素材" }));
  const length = history.length;
  act(() => history.back());
  await waitFor(() =>
    expect(screen.getByLabelText("路径").textContent).toBe(home),
  );
  expect(location.pathname).toBe(home);
  act(() => history.forward());
  await waitFor(() =>
    expect(screen.getByLabelText("路径").textContent).toBe(assets),
  );
  expect(history.length).toBe(length);
});

test("cancelling a dirty Back restores the URL without losing the forward stack", async () => {
  render(
    <NavigationProtection>
      <Workspace />
    </NavigationProtection>,
  );
  fireEvent.click(screen.getByRole("button", { name: "素材" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "keep draft" },
  });
  const length = history.length;
  act(() => history.back());
  await screen.findByRole("alertdialog", { name: "未保存草稿" });
  await waitFor(() => expect(location.search).toBe("?kind=image"));
  fireEvent.click(screen.getByRole("button", { name: "留在此页" }));
  expect(screen.getByLabelText("路径")).toHaveTextContent(assets);
  expect(screen.getByRole("textbox")).toHaveValue("keep draft");
  act(() => history.back());
  await screen.findByRole("alertdialog");
  await waitFor(() => expect(location.search).toBe("?kind=image"));
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  await waitFor(() => expect(location.pathname).toBe(home));
  expect(screen.getByLabelText("路径")).toHaveTextContent(home);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  act(() => history.forward());
  await waitFor(() =>
    expect(screen.getByLabelText("路径")).toHaveTextContent(assets),
  );
  expect(history.length).toBe(length);
});

test("same-application links use guarded navigation; other link gestures keep browser behavior", () => {
  render(
    <NavigationProtection>
      <Workspace />
    </NavigationProtection>,
  );
  const intercepted: boolean[] = [];
  const browserDefault = (event: MouseEvent) => {
    intercepted.push(event.defaultPrevented);
    event.preventDefault();
  };
  window.addEventListener("click", browserDefault);
  for (const name of ["新窗口", "下载"]) {
    // Prevent jsdom's unsupported document navigation after checking interception.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name }).dispatchEvent(event);
  }
  const modified = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  screen.getByRole("link", { name: "任务链接" }).dispatchEvent(modified);
  expect(intercepted).toEqual([false, false, false]);
  window.removeEventListener("click", browserDefault);
  fireEvent.click(screen.getByRole("link", { name: "任务链接" }));
  expect(location.search).toBe("?kind=image");
});

test("local navigation does not approve a later document unload", () => {
  render(
    <NavigationProtection>
      <Workspace />
    </NavigationProtection>,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  fireEvent.click(screen.getByRole("button", { name: "素材" }));
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

test("a cold lazy page keeps the current content visible until its module is ready", async () => {
  let loaded!: (module: { default: () => ReactElement }) => void;
  const module = new Promise<{ default: () => ReactElement }>((resolve) => {
    loaded = resolve;
  });
  const Target = lazy(() => module);
  function Pages() {
    const { path, navigate } = useApplicationNavigation("visual", ownsPath);
    return (
      <>
        <button onClick={() => navigate(assets)}>切换页面</button>
        <Suspense fallback={<p>整页占位</p>}>
          {path === home ? <p>当前内容</p> : <Target />}
        </Suspense>
      </>
    );
  }
  render(
    <NavigationProtection>
      <Pages />
    </NavigationProtection>,
  );
  fireEvent.click(screen.getByRole("button", { name: "切换页面" }));
  expect(screen.getByText("当前内容")).toBeVisible();
  expect(screen.queryByText("整页占位")).not.toBeInTheDocument();
  await act(async () => {
    loaded({ default: () => <p>目标内容</p> });
  });
  expect(screen.getByText("目标内容")).toBeVisible();
});
