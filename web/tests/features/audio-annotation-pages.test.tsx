import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AudioAnnotationProjectsPage } from "@features/audio-annotation/AudioAnnotationProjectsPage";
import {
  importAudioAnnotationTranscriptionJson,
  listAudioAnnotationProjects,
} from "@features/audio-annotation/api";
import { getFiles } from "@features/files";

vi.mock("@features/files", () => ({
  getFiles: vi.fn().mockResolvedValue({
    items: [
      {
        id: "audio-asset",
        project_id: null,
        folder_id: null,
        original_filename: "episode.wav",
        display_name: "广播剧音频",
        media_kind: "audio",
        mime_type: "audio/wav",
        byte_size: 2048,
        revision: 0,
        created_at: "2026-08-20T00:00:00Z",
        updated_at: "2026-08-20T00:00:00Z",
        source: "library",
        is_reference: false,
        reference_id: null,
      },
    ],
  }),
  uploadManagedFile: vi.fn(),
}));

vi.mock("@features/audio-annotation/api", () => ({
  createAudioAnnotationProject: vi.fn(),
  deleteAudioAnnotationProject: vi.fn(),
  importAudioAnnotationProject: vi.fn(),
  importAudioAnnotationTranscriptionJson: vi.fn().mockResolvedValue({
    id: "imported-project",
  }),
  listAudioAnnotationProjects: vi.fn().mockResolvedValue({ items: [] }),
  renameAudioAnnotationProject: vi.fn(),
}));

function renderPage(onOpen = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AudioAnnotationProjectsPage onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
}

test("imports portable transcription JSON after explicitly selecting its audio", async () => {
  const user = userEvent.setup();
  const onOpen = renderPage();
  await waitFor(() => expect(listAudioAnnotationProjects).toHaveBeenCalled());
  await waitFor(() => expect(getFiles).not.toHaveBeenCalled());

  const input = screen.getByLabelText("导入项目 JSON");
  const portable = {
    kind: "future-props-transcription",
    schema_version: "1.0",
    exported_at: "2026-08-20T00:00:00Z",
    source: {
      kind: "library",
      asset_id: "stale-source-id",
      filename: "episode.wav",
      mime_type: "audio/wav",
      byte_size: 2048,
    },
    recognition: {
      task_id: "transcription-1",
      provider_kind: "senseaudio_asr_pro",
      provider_name: "专业识别",
      model_slug: "pro-asr",
      language: "ja",
      created_at: "2026-08-20T00:00:00Z",
      completed_at: "2026-08-20T00:00:01Z",
      text: "识别全文",
      segments: [
        { speaker: "SPK_1", start_ms: 0, end_ms: 99, text: "短片段" },
        { speaker: "SPK_0", start_ms: 0, end_ms: 900, text: "第一句" },
      ],
    },
  };
  await user.upload(
    input,
    new File([JSON.stringify(portable)], "episode.transcription.json", {
      type: "application/json",
    }),
  );

  expect(
    await screen.findByRole("dialog", { name: "导入标注项目" }),
  ).toBeInTheDocument();
  expect(screen.getByText("导入识别 JSON")).toBeInTheDocument();
  expect(
    screen.getByText(
      "导入时会自动忽略 1 个短于 100 毫秒的识别片段，其余片段的时间和说话人会原样保留。",
    ),
  ).toBeInTheDocument();
  expect(await screen.findByDisplayValue("episode")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导入并打开" })).toBeDisabled();
  await user.click(await screen.findByRole("option", { name: /广播剧音频/ }));
  await user.click(screen.getByRole("button", { name: "导入并打开" }));

  await waitFor(() =>
    expect(importAudioAnnotationTranscriptionJson).toHaveBeenCalledWith(
      "episode",
      "audio-asset",
      "识别全文",
      portable.recognition.segments,
    ),
  );
  expect(onOpen).toHaveBeenCalledWith("imported-project");
});

test("annotation editor page owns viewport height outside StudioShell", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const foundation = readFileSync(
    resolve("src/features/audio-annotation/audio-annotation-foundation.css"),
    "utf8",
  );
  const shell = readFileSync(
    resolve("src/app/layout/studio-shell.css"),
    "utf8",
  );
  expect(foundation).toMatch(
    /\.annotation-editor-page\s*\{[^}]*height:\s*100dvh/s,
  );
  expect(shell).toMatch(
    /\.studio-main:has\(\.annotation-editor-page\)\s*>\s*\.annotation-editor-page\s*\{[^}]*height:\s*100%/s,
  );
});
