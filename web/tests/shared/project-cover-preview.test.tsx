import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { ProjectCoverPreview } from "../../src/shared/ui/project-library/ProjectCoverPreview";
import { PreviewQueue } from "../../src/shared/ui/project-library/previewQueue";
import { fetchApiBlob } from "@platform/api/client";

vi.mock("@platform/api/client", async (original) => ({
  ...(await original<typeof import("@platform/api/client")>()),
  fetchApiBlob: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(fetchApiBlob).mockReset();
  vi.stubGlobal("IntersectionObserver", undefined);
  URL.createObjectURL = vi.fn(() => "blob:cover");
  URL.revokeObjectURL = vi.fn();
});
function show(
  preview: Partial<
    NonNullable<React.ComponentProps<typeof ProjectCoverPreview>["preview"]>
  > & {
    kind: "image" | "text" | "table" | "waveform" | "scene";
    version: string;
  },
  renderFrame?: (signal: AbortSignal) => Promise<Blob>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectCoverPreview
        projectId="p"
        title="我的项目"
        preview={{ source_time: 0, text: "", label: "", ...preview }}
        render={renderFrame}
      />
    </QueryClientProvider>,
  );
}

test("media failures fall through to the next real source and object URLs are released", async () => {
  vi.mocked(fetchApiBlob)
    .mockRejectedValueOnce(new Error("deleted"))
    .mockResolvedValueOnce(new Blob(["png"], { type: "image/png" }));
  const view = show({
    kind: "image",
    version: "v1",
    urls: ["/v1/files/removed/thumbnail", "/v1/files/valid/thumbnail"],
  });
  expect(await screen.findByAltText("我的项目的项目预览")).toHaveAttribute(
    "src",
    "blob:cover",
  );
  expect(fetchApiBlob).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover");
});

test("saved cells and actual waveform render without downloading source documents or audio", () => {
  const view = show({
    kind: "table",
    version: "v1",
    label: "预算",
    cells: [[{ text: "¥120", bold: true }]],
  });
  expect(screen.getByRole("table")).toHaveTextContent("¥120");
  view.unmount();
  show({
    kind: "waveform",
    version: "v2",
    peaks: [0.2, 0.8],
    label: "1:30",
    text: "访谈内容",
  });
  expect(screen.getByRole("img", { name: "我的项目的音频波形" })).toBeVisible();
  expect(screen.getByText("访谈内容")).toBeVisible();
  expect(fetchApiBlob).not.toHaveBeenCalled();
});

test("offscreen cards never start rendering and cancel when unmounted", async () => {
  let observe!: IntersectionObserverCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observe = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  let usedSignal: AbortSignal | undefined;
  const frame = vi.fn((signal: AbortSignal) => {
    usedSignal = signal;
    return new Promise<Blob>(() => {});
  });
  const view = show({ kind: "scene", version: "v3" }, frame);
  expect(frame).not.toHaveBeenCalled();
  act(() =>
    observe(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  await waitFor(() => expect(frame).toHaveBeenCalledOnce());
  view.unmount();
  expect(usedSignal?.aborted).toBe(true);
});

test("complex render queue serializes work and skips cancelled waiting cards", async () => {
  const queue = new PreviewQueue(1);
  let complete!: () => void;
  const first = queue.run(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const cancelled = new AbortController();
  const action = vi.fn();
  const second = queue.run(cancelled.signal, action).catch(() => {});
  await Promise.resolve();
  cancelled.abort();
  complete();
  await Promise.all([first, second]);
  expect(action).not.toHaveBeenCalled();
  await queue.run(new AbortController().signal, async () => {
    action();
  });
  expect(action).toHaveBeenCalledOnce();
});
