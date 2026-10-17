import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFiles, getFolders, type ManagedFile } from "@features/files";
import { fetchApiDownload } from "@platform/api/client";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";

vi.mock("@features/files/api", async (original) => ({
  ...(await original<typeof import("@features/files/api")>()),
  getFiles: vi.fn(),
  getFolders: vi.fn(),
}));
vi.mock("@platform/api/client", async (original) => ({
  ...(await original<typeof import("@platform/api/client")>()),
  fetchApiDownload: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: "", error: new Error("预览加载失败") }),
}));

const createObjectURL = vi.fn(() => "blob:download");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPreview(kind: "image" | "video" | "audio") {
  const file: ManagedFile = {
    id: `${kind}/asset`,
    project_id: "project",
    folder_id: null,
    reference_id: null,
    original_filename: `${kind}.original`,
    display_name: `参考${kind}`,
    media_kind: kind,
    mime_type: `${kind}/test`,
    byte_size: 100,
    source: "project",
    is_reference: false,
    revision: 0,
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
  };
  vi.mocked(getFiles).mockResolvedValue({ items: [file] });
  const changed = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectMediaPicker
        minimal
        projectId="project"
        label="参考素材"
        kind={kind}
        value={[file.id]}
        onChange={changed}
      />
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: file.display_name }),
  );
  const dialog = screen.getByRole("dialog", { name: file.display_name });
  const button = within(dialog).getByRole("button", {
    name: "下载当前预览素材",
  });
  return { user, dialog, button, file, changed };
}

test.each(["image", "video", "audio"] as const)(
  "downloads the current %s reference even if preview loading failed, preserving selection",
  async (kind) => {
    const blob = new Blob([kind]);
    vi.mocked(fetchApiDownload).mockResolvedValue({
      blob,
      filename: `素材.${kind}`,
    });
    const saved: { href: string; filename: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ href: this.href, filename: this.download });
    });
    const { user, dialog, button, file, changed } = await openPreview(kind);
    button.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(saved).toEqual([
        { href: "blob:download", filename: `素材.${kind}` },
      ]),
    );
    expect(fetchApiDownload).toHaveBeenCalledExactlyOnceWith(
      `/v1/files/${kind}%2Fasset/download`,
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "关闭预览" }));
    expect(
      screen.getByRole("button", { name: file.display_name }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(changed).not.toHaveBeenCalled();
  },
);

test("prevents repeated downloads while pending and allows a manual retry after failure", async () => {
  let rejectDownload!: (error: Error) => void;
  vi.mocked(fetchApiDownload).mockReturnValueOnce(
    new Promise((_, reject) => {
      rejectDownload = reject;
    }),
  );
  let savedFilename = "";
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      savedFilename = this.download;
    });
  const { user, dialog, button, file } = await openPreview("image");
  await user.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveTextContent("下载中…");
  await user.click(button);
  expect(fetchApiDownload).toHaveBeenCalledTimes(1);
  rejectDownload(new Error("下载失败，请重试。"));
  expect(await within(dialog).findByText("下载失败，请重试。")).toHaveAttribute(
    "role",
    "alert",
  );
  expect(button).toBeEnabled();
  expect(createObjectURL).not.toHaveBeenCalled();
  vi.mocked(fetchApiDownload).mockResolvedValueOnce({
    blob: new Blob(["image"]),
    filename: null,
  });
  await user.click(button);
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(savedFilename).toBe(file.original_filename);
  expect(within(dialog).queryByText("下载失败，请重试。")).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledOnce();
});
