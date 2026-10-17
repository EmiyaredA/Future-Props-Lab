import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { OutputHistory } from "@features/visual-workshop/board/OutputHistory";
import type { BoardController } from "@features/visual-workshop/board/boardTypes";
import {
  getNodeOutputs,
  uploadNodeOutput,
} from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/api", async (original) => ({
  ...(await original<typeof import("@features/visual-workshop/api")>()),
  getNodeOutputs: vi.fn(),
  uploadNodeOutput: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: "", loading: false, error: null }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNodeOutputs).mockResolvedValue({ items: [], total: 0 });
});

function setup(kind: "image" | "video" | "audio" = "video") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const prepareCanvasForAgent = vi.fn().mockResolvedValue(7);
  const controller = {
    projectId: "project",
    nodes: [{ id: "dance", kind, title: "舞蹈", position: { x: 0, y: 0 } }],
    edges: [],
    client,
    prepareCanvasForAgent,
  } as unknown as BoardController;
  render(
    <QueryClientProvider client={client}>
      <OutputHistory
        controller={controller}
        nodeId="dance"
        onPreview={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return {
    client,
    prepareCanvasForAgent,
    input: screen.getByLabelText("上传输出版本"),
  };
}

test("video output picker accepts a GIF and sends the original file with the saved revision", async () => {
  const user = userEvent.setup();
  const { input, prepareCanvasForAgent } = setup();
  expect(input).toHaveAttribute("accept", "video/*,image/gif,.gif");
  expect(screen.getByText(/GIF 转为无声 MP4/)).toBeVisible();
  vi.mocked(uploadNodeOutput).mockResolvedValue({
    project_id: "project",
    nodes: [],
    edges: [],
    revision: 8,
    categories: [],
    updated_at: "2026-10-17T04:00:00Z",
  });
  const gif = new File(["GIF89a"], "dance.gif", { type: "image/gif" });
  await user.upload(input, gif);
  await waitFor(() =>
    expect(uploadNodeOutput).toHaveBeenCalledWith("project", "dance", gif, 7),
  );
  expect(prepareCanvasForAgent).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "上传版本" })).toBeEnabled(),
  );
  expect(input).toHaveValue("");
});

test("failed GIF conversion shows the server error and allows an explicit retry", async () => {
  const user = userEvent.setup();
  const { input } = setup();
  vi.mocked(uploadNodeOutput).mockRejectedValue(
    new Error("GIF 动画无法解码或转换"),
  );
  const gif = new File(["GIF89a"], "dance.gif", { type: "image/gif" });
  await user.upload(input, gif);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "GIF 动画无法解码或转换",
  );
  expect(screen.getByRole("button", { name: "上传版本" })).toBeEnabled();
  await user.upload(input, gif);
  await waitFor(() => expect(uploadNodeOutput).toHaveBeenCalledTimes(2));
});

test.each(["image", "audio"] as const)(
  "%s output keeps its own upload type",
  (kind) => {
    const { input } = setup(kind);
    expect(input).toHaveAttribute("accept", `${kind}/*`);
    expect(screen.queryByText(/GIF 转为无声 MP4/)).not.toBeInTheDocument();
  },
);
