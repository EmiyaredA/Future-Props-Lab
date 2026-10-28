import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExportDialog from "@features/presentation-workshop/exchange/ExportDialog";
import { newDeck } from "@features/presentation-workshop/templates";
import type { Project } from "@features/presentation-workshop/types";
import type { DesktopBridge } from "@platform/desktop";
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
const receipt = {
  id: "saved-file",
  path: "/Users/example/Desktop/交付文稿.pptx",
};
const save = vi.fn(),
  reveal = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  window.futurePropsDesktop = {
    saveExportFile: save,
    revealExportFile: reveal,
  } as unknown as DesktopBridge;
  save.mockResolvedValue(receipt);
  reveal.mockResolvedValue(undefined);
  vi.mocked(previewExport).mockResolvedValue({ issues: [], revision: 7 });
  vi.mocked(exportProject).mockResolvedValue(blob);
});
afterEach(() => {
  delete window.futurePropsDesktop;
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

it("PPTX opens with progress, waits for save completion, then shows the actual path", async () => {
  let finish!: (value: typeof receipt) => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { onClose } = open();
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      "交付文稿.pptx",
      new Uint8Array([80, 75, 3, 4]),
    ),
  );
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  expect(screen.getByText("请选择保存位置，确认后写入文件…")).toBeVisible();
  expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByText("导出文件已保存")).not.toBeInTheDocument();
  await act(async () => finish(receipt));
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText(receipt.path)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "在文件夹中显示" }));
  expect(reveal).toHaveBeenCalledWith(receipt.id);
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  expect(onClose).toHaveBeenCalledOnce();
});

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
  expect(save).not.toHaveBeenCalled();
  await act(async () => finish(blob));
  await screen.findByText(receipt.path);
});

it("canceling the save dialog preserves the generated file for choosing another location", async () => {
  save.mockResolvedValueOnce(null);
  const { getSnapshot, onClose } = open();
  await screen.findByText("已取消保存，文件尚未保存。");
  expect(screen.queryByText("导出文件已保存")).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "选择保存位置" }));
  await screen.findByText(receipt.path);
  expect(exportProject).toHaveBeenCalledOnce();
  expect(getSnapshot).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledTimes(2);
});

it("write failures stay visible and retry saving without repeating generation", async () => {
  save.mockRejectedValueOnce(new Error("磁盘空间不足"));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘空间不足");
  expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "选择保存位置" }));
  await screen.findByText(receipt.path);
  expect(exportProject).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("a conversion or version conflict error never triggers a file save", async () => {
  vi.mocked(exportProject).mockRejectedValueOnce(new Error("文稿版本冲突"));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("文稿版本冲突");
  expect(save).not.toHaveBeenCalled();
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
  await screen.findByText(receipt.path);
  expect(exportProject).toHaveBeenCalledOnce();
});

it("browser fallback reports a download handoff without claiming to know its path", async () => {
  delete window.futurePropsDesktop;
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

it("folder reveal errors do not erase the successful save receipt", async () => {
  reveal.mockRejectedValueOnce(new Error("无法显示文件夹"));
  open();
  await screen.findByText(receipt.path);
  fireEvent.click(screen.getByRole("button", { name: "在文件夹中显示" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("无法显示文件夹");
  expect(screen.getByText(receipt.path)).toBeVisible();
});
