import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { getFiles, getFolders, uploadManagedFile } from "@features/files/api";
import type { ManagedFile, MediaKind } from "@features/files";
import { ProjectMediaPicker } from "@features/visual-workshop/generation/ProjectMediaPicker";
import { MEDIA_ACCEPT } from "@features/visual-workshop/generation/options";

vi.mock("@features/files/api", async (original) => ({
  ...(await original<typeof import("@features/files/api")>()),
  getFiles: vi.fn(),
  getFolders: vi.fn(),
  uploadManagedFile: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: undefined, error: undefined }),
}));

const kinds = ["image", "video", "audio"] as const;
const names = { image: "图片", video: "视频", audio: "音频" };
const types = { image: "image/png", video: "video/mp4", audio: "audio/mpeg" };
const extensions = { image: "png", video: "mp4", audio: "mp3" };
function managedFile(kind: MediaKind): ManagedFile {
  return {
    id: `uploaded-${kind}`,
    project_id: "project-1",
    folder_id: null,
    reference_id: null,
    original_filename: `reference.${extensions[kind as keyof typeof extensions]}`,
    display_name: `参考${names[kind as keyof typeof names]}`,
    media_kind: kind,
    mime_type: types[kind as keyof typeof types],
    byte_size: 64,
    source: "project",
    is_reference: false,
    revision: 0,
    created_at: "2026-11-21T00:00:00Z",
    updated_at: "2026-11-21T00:00:00Z",
  };
}
function Picker({
  kind,
  disabled = false,
  max = 1,
}: {
  kind: (typeof kinds)[number];
  disabled?: boolean;
  max?: number;
}) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <ProjectMediaPicker
      projectId="project-1"
      kind={kind}
      label={`参考${names[kind]}`}
      minimal
      compactStrip
      multiple
      disabled={disabled}
      max={max}
      value={value}
      onChange={setValue}
    />
  );
}
function setup(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  vi.mocked(uploadManagedFile).mockImplementation(async (file) => {
    const kind = kinds.find((item) => file.type.startsWith(item))!;
    return managedFile(kind);
  });
});

test("each media tile directly opens its own typed file picker without a source menu", async () => {
  const user = userEvent.setup();
  setup(
    <>
      {kinds.map((kind) => (
        <Picker key={kind} kind={kind} />
      ))}
    </>,
  );
  for (const kind of kinds) {
    const button = await screen.findByRole("button", {
      name: `上传参考${names[kind]}`,
    });
    const input = screen.getByLabelText(
      `上传参考${names[kind]}文件`,
    ) as HTMLInputElement;
    expect(input).toHaveAttribute("accept", MEDIA_ACCEPT[kind]);
    expect(input.multiple).toBe(true);
    const open = vi.spyOn(input, "click").mockImplementation(() => {});
    await user.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    open.mockRestore();
    await user.upload(
      input,
      new File(["media"], `local.${extensions[kind]}`, { type: types[kind] }),
    );
    expect(
      await screen.findByRole("button", { name: `参考${names[kind]}` }),
    ).toBeVisible();
    expect(button).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `参考${names[kind]}更多来源` }),
    ).toBeDisabled();
  }
  expect(uploadManagedFile).toHaveBeenCalledTimes(3);
});

test("canceling a picker or choosing the wrong type does not upload; more sources stay secondary", async () => {
  const user = userEvent.setup();
  setup(<Picker kind="image" />);
  await screen.findByRole("button", { name: "上传参考图片" });
  const input = screen.getByLabelText("上传参考图片文件");
  fireEvent.change(input, { target: { files: [] } });
  await user.upload(
    input,
    new File(["audio"], "wrong.mp3", { type: "audio/mpeg" }),
  );
  expect(uploadManagedFile).not.toHaveBeenCalled();
  const more = screen.getByRole("button", { name: "参考图片更多来源" });
  await user.click(more);
  expect(screen.getByRole("menu", { name: "参考图片来源" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(more).toHaveFocus();
});

test("pending upload blocks duplicate selection and a failed upload can be retried", async () => {
  let rejectUpload!: (error: Error) => void;
  vi.mocked(uploadManagedFile).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectUpload = reject;
      }),
  );
  const user = userEvent.setup();
  setup(<Picker kind="video" />);
  const button = await screen.findByRole("button", { name: "上传参考视频" });
  const input = screen.getByLabelText("上传参考视频文件");
  const file = new File(["video"], "local.mp4", { type: "video/mp4" });
  await user.upload(input, file);
  expect(button).toBeDisabled();
  expect(input).toBeDisabled();
  rejectUpload(new Error("connection lost"));
  expect(await screen.findByRole("alert")).toBeVisible();
  await waitFor(() => expect(button).toBeEnabled());
  await user.upload(input, file);
  expect(await screen.findByRole("button", { name: "参考视频" })).toBeVisible();
  expect(uploadManagedFile).toHaveBeenCalledTimes(2);
});

test("a disabled editor cannot open either upload or secondary sources", async () => {
  setup(<Picker kind="audio" disabled />);
  expect(
    await screen.findByRole("button", { name: "上传参考音频" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "参考音频更多来源" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("上传参考音频文件")).toBeDisabled();
});
