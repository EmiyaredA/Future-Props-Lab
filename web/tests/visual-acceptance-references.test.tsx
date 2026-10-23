import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AcceptanceNodePicker } from "@features/visual-workshop/acceptance/AcceptanceNodePicker";
import { ReferenceMaterials } from "@features/visual-workshop/acceptance/ReferenceMaterials";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
import { fetchApiBlob } from "@platform/api/client";

vi.mock("@platform/api/client", () => ({ fetchApiBlob: vi.fn() }));
const fetchBlob = vi.mocked(fetchApiBlob);
let sequence = 0;
const createUrl = vi.fn(() => `blob:reference-${++sequence}`);
const revokeUrl = vi.fn();
const nodes = [
  { id: "image", kind: "image", asset_id: "png", title: "角色基准" },
  { id: "duplicate", kind: "image", asset_id: "png", title: "重复节点" },
  { id: "video", kind: "video", asset_id: "mp4", title: "动作参考" },
  { id: "empty", kind: "image", title: "空节点" },
  { id: "audio", kind: "audio", asset_id: "wav", title: "音频" },
].map((node) => ({ ...node, position: { x: 0, y: 0 } })) as VisualCanvasNode[];
function References({ initial = [] as string[], disabled = false }) {
  const [ids, setIds] = useState(initial);
  return (
    <ReferenceMaterials
      ids={ids}
      nodes={nodes}
      onChange={setIds}
      disabled={disabled}
    />
  );
}
beforeEach(() => {
  sequence = 0;
  createUrl.mockClear();
  revokeUrl.mockClear();
  fetchBlob.mockReset();
  fetchBlob.mockImplementation(
    async (path) =>
      new Blob(["fixture"], {
        type: String(path).includes("mp4") ? "video/mp4" : "image/png",
      }),
  );
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const openPicker = async () => {
  await userEvent.click(screen.getByRole("button", { name: "选择参考" }));
  return screen.getByRole("region", { name: "选择项目参考素材" });
};

test("thumbnail list deduplicates assets, shows actual formats and binds, replaces and removes", async () => {
  render(<References />);
  const picker = await openPicker();
  expect(within(picker).getAllByRole("listitem")).toHaveLength(2);
  await within(picker).findByText("图片 · PNG");
  expect(within(picker).getByText("视频 · MP4")).toBeVisible();
  await userEvent.click(
    within(picker).getByRole("button", { name: "绑定 角色基准" }),
  );
  expect(
    screen.queryByRole("region", { name: "选择项目参考素材" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("固定素材")).toBeVisible();
  await openPicker();
  expect(screen.getByRole("button", { name: "绑定 角色基准" })).toBeDisabled();
  expect(screen.getByText(/已绑定$/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  await userEvent.click(screen.getByRole("button", { name: "替换参考 1" }));
  await userEvent.click(screen.getByRole("button", { name: "绑定 动作参考" }));
  expect(screen.getByRole("list", { name: "已绑定参考" })).toHaveTextContent(
    "动作参考",
  );
  await userEvent.click(screen.getByRole("button", { name: "解除参考 1" }));
  expect(screen.getByText(/尚未绑定参考/)).toBeVisible();
});

test("limit and readonly disable mutations, while bound thumbnails remain visible", async () => {
  const view = render(<References initial={["1", "2", "3", "4", "5", "6"]} />);
  expect(screen.getByRole("button", { name: "选择参考" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "替换参考 1" })).toBeEnabled();
  view.unmount();
  render(<References initial={["png"]} disabled />);
  expect(screen.getByRole("button", { name: "选择参考" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "替换参考 1" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "解除参考 1" })).toBeDisabled();
  await screen.findByText("图片 · PNG");
  expect(
    screen.queryByRole("button", { name: /^预览 / }),
  ).not.toBeInTheDocument();
});

test("reference rows do not open previews and Escape closes the picker with focus restored", async () => {
  render(<References />);
  const picker = await openPicker();
  await within(picker).findByText("图片 · PNG");
  fireEvent.pointerEnter(
    within(picker).getByRole("listitem", { name: "角色基准" }),
  );
  expect(
    screen.queryByRole("button", { name: /^预览 / }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(
    screen.queryByRole("region", { name: "选择项目参考素材" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择参考" })).toHaveFocus();
});

test("failed thumbnail requests stay removable", async () => {
  fetchBlob.mockRejectedValue(new Error("missing"));
  const onChange = vi.fn();
  render(
    <ReferenceMaterials
      ids={["missing"]}
      nodes={[]}
      onChange={onChange}
      disabled={false}
    />,
  );
  await screen.findByText("不可读取");
  await userEvent.click(screen.getByRole("button", { name: "解除参考 1" }));
  expect(onChange).toHaveBeenCalledWith([]);
});

test("only intersecting rows request blobs, visibility loss and picker close abort and revoke", async () => {
  const observers: {
    callback: IntersectionObserverCallback;
    target?: Element;
  }[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {}
    },
  );
  const view = render(<References />);
  await openPicker();
  expect(fetchBlob).not.toHaveBeenCalled();
  const intersect = (index: number, visible: boolean) =>
    act(() =>
      observers[index].callback(
        [
          {
            isIntersecting: visible,
            target: observers[index].target,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
  intersect(0, true);
  await screen.findByText("图片 · PNG");
  expect(fetchBlob).toHaveBeenCalledTimes(1);
  const firstSignal = fetchBlob.mock.calls[0][1]!.signal!;
  intersect(0, false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(firstSignal.aborted).toBe(true);
  expect(revokeUrl).toHaveBeenCalledWith("blob:reference-1");
  intersect(1, true);
  await screen.findByText("视频 · MP4");
  const secondSignal = fetchBlob.mock.calls[1][1]!.signal!;
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(secondSignal.aborted).toBe(true);
  expect(revokeUrl).toHaveBeenCalledWith("blob:reference-2");
  view.unmount();
});

test("a late aborted blob never replaces the newly visible row source", async () => {
  let resolveBlob: ((blob: Blob) => void) | undefined;
  fetchBlob.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveBlob = resolve;
      }),
  );
  render(<References />);
  await openPicker();
  await screen.findByText("视频 · MP4");
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () =>
    resolveBlob!(new Blob(["late"], { type: "image/png" })),
  );
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("decoding failures show a fallback while keeping independent binding available", async () => {
  render(<References />);
  const picker = await openPicker();
  await within(picker).findByText("图片 · PNG");
  fireEvent.error(picker.querySelector("img")!);
  expect(within(picker).getByText("无预览")).toBeVisible();
  expect(screen.getByRole("button", { name: "绑定 角色基准" })).toBeEnabled();
});

function NodePicker() {
  const [value, setValue] = useState("image");
  return (
    <AcceptanceNodePicker nodes={nodes} value={value} onChange={setValue} />
  );
}

test("node selection uses material rows, marks current node and preserves nodes without outputs", async () => {
  render(<NodePicker />);
  const trigger = screen.getByRole("button", { name: "验收节点" });
  await userEvent.click(trigger);
  const picker = screen.getByRole("region", { name: "选择验收节点" });
  expect(within(picker).getAllByRole("listitem")).toHaveLength(5);
  await within(picker).findAllByText("图片 · PNG");
  expect(within(picker).getByText("视频 · MP4")).toBeVisible();
  expect(within(picker).getByText("音频", { selector: "small" })).toBeVisible();
  expect(
    within(picker).getByRole("button", { name: "选择 角色基准" }),
  ).toHaveAttribute("aria-pressed", "true");
  const empty = within(picker).getByRole("button", { name: "选择 空节点" });
  expect(empty).toBeEnabled();
  expect(empty).toHaveTextContent("暂无最终输出");
  await userEvent.click(
    within(picker).getByRole("button", { name: "选择 动作参考" }),
  );
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveTextContent("动作参考");
  await userEvent.click(trigger);
  expect(screen.getByRole("button", { name: "选择 动作参考" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "选择 角色基准" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("node picker keyboard cancel restores focus and text/audio rows do not fetch thumbnails", async () => {
  const onChange = vi.fn();
  render(
    <AcceptanceNodePicker
      nodes={[
        {
          id: "script",
          kind: "text",
          title: "台词脚本",
          text: "你好",
          position: { x: 0, y: 0 },
        },
        nodes[4],
      ]}
      value="script"
      onChange={onChange}
    />,
  );
  const trigger = screen.getByRole("button", { name: "验收节点" });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("region", { name: "选择验收节点" })).toHaveFocus();
  expect(screen.getByText("文本")).toBeVisible();
  expect(fetchBlob).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(trigger).toHaveFocus();
  expect(onChange).not.toHaveBeenCalled();
});
