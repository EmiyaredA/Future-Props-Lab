import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ExportDialog from "@features/presentation-workshop/exchange/ExportDialog";
import { newDeck } from "@features/presentation-workshop/templates";
import type { Project } from "@features/presentation-workshop/types";
import { download, exportProject } from "@features/presentation-workshop/api";
import { previewExport } from "@features/presentation-workshop/exchange/api";

vi.mock("@features/presentation-workshop/api", () => ({
  exportProject: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@features/presentation-workshop/exchange/api", () => ({
  previewExport: vi.fn(),
  exportFile: vi.fn(),
}));
const project = {
  id: "project",
  revision: 7,
  title: "交付文稿",
  document: newDeck(),
} as Project;
const blob = {
  arrayBuffer: () => Promise.resolve(new Uint8Array([80, 75, 3, 4]).buffer),
} as Blob;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(previewExport).mockResolvedValue({ issues: [], revision: 7 });
  vi.mocked(exportProject).mockResolvedValue(blob);
});
function open(getSnapshot = vi.fn().mockResolvedValue(project)) {
  const onClose = vi.fn();
  render(
    <ExportDialog
      format="pptx"
      current={0}
      getSnapshot={getSnapshot}
      onClose={onClose}
    />,
  );
  return { onClose, getSnapshot };
}

it("shows generation progress and prevents duplicate submissions", async () => {
  let finish!: (value: Blob) => void;
  vi.mocked(exportProject).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  open();
  await screen.findByText(/正在生成 PPTX/);
  const button = screen.getByRole("button", { name: "正在导出…" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(exportProject).toHaveBeenCalledExactlyOnceWith(project.id, 7);
  expect(download).not.toHaveBeenCalled();
  await act(async () => finish(blob));
  await screen.findByText(/已发起下载：交付文稿.pptx/);
});

it("a conversion or version conflict error never triggers a file save", async () => {
  vi.mocked(exportProject).mockRejectedValueOnce(new Error("文稿版本冲突"));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("文稿版本冲突");
  expect(download).not.toHaveBeenCalled();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("conversion differences require explicit acceptance before generating a PPTX", async () => {
  vi.mocked(previewExport).mockResolvedValue({
    revision: 7,
    issues: [
      {
        message: "动画将变为静态",
        code: "animation",
        slide_id: project.document.slides[0].id,
        element_id: null,
      },
    ],
  });
  open();
  await screen.findByText(/动画将变为静态/);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "导出文件" })).toBeEnabled(),
  );
  expect(exportProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认转换差异" }));
  fireEvent.click(screen.getByRole("button", { name: "导出文件" }));
  await screen.findByText(/已发起下载：交付文稿.pptx/);
  expect(exportProject).toHaveBeenCalledOnce();
});

it("browser fallback reports a download handoff without claiming to know its path", async () => {
  const { onClose } = open();
  await screen.findByText(/已发起下载：交付文稿.pptx/);
  expect(download).toHaveBeenCalledWith(blob, "交付文稿.pptx");
  expect(screen.queryByText("导出文件已保存")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "在文件夹中显示" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  expect(onClose).toHaveBeenCalledOnce();
});
