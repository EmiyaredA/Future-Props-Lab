import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useAudioAnnotationEditorController } from "@features/audio-annotation/useAudioAnnotationEditorController";
import { audioAnnotationQueryKeys } from "@features/audio-annotation/queryKeys";
import type { AudioAnnotationDocument } from "@features/audio-annotation/types";

const api = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@features/audio-annotation/segmentTranscription", () => ({
  useSegmentTranscription: () => ({}),
}));
vi.mock("@features/audio-annotation/api", () => ({
  getAudioAnnotationDocument: async () => ({
    project_id: "project",
    revision: 0,
    schema_version: "1.0",
    speakers: [],
    segments: [],
    custom_emotions: [],
    updated_at: "2026-11-16T00:00:00Z",
  }),
  getAudioAnnotationProject: async () => ({ id: "project", duration_ms: 2000 }),
  getAudioAnnotationWaveform: async () => ({ peaks: [], revision: 0 }),
  putAudioAnnotationDocument: (...args: unknown[]) => api.put(...args),
  putAudioAnnotationWaveform: vi.fn(),
}));

test("a save accepted before logout cannot repopulate the cleared account cache", async () => {
  let resolveSave!: (document: AudioAnnotationDocument) => void;
  api.put.mockImplementation(
    () =>
      new Promise<AudioAnnotationDocument>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { result, unmount } = renderHook(
    () =>
      useAudioAnnotationEditorController({
        projectId: "project",
        accountId: "account",
        onBack: vi.fn(),
        registerNavigationGuard: vi.fn(),
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.status).toBe("ready"));
  if (result.current.status !== "ready") throw new Error("editor not loaded");
  const document = result.current.document;
  act(() => {
    if (result.current.status === "ready")
      result.current.applySnapshot({
        ...document,
        custom_emotions: [{ name: "edited", color: "#ffffff" }],
      });
  });
  act(() => {
    if (result.current.status === "ready") result.current.flushSave();
  });
  await waitFor(() => expect(api.put).toHaveBeenCalledOnce());
  const mutation = client.getMutationCache().getAll()[0];
  unmount();
  client.clear();
  resolveSave({ ...document, revision: 1 });
  await waitFor(() => expect(mutation.state.status).toBe("success"));
  expect(
    client.getQueryData(audioAnnotationQueryKeys.document("project")),
  ).toBeUndefined();
});
