import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@platform/api/client";
import { newDeck } from "@features/presentation-workshop/templates";
import { usePresentationDraft } from "@features/presentation-workshop/usePresentationDraft";
import type { Project } from "@features/presentation-workshop/types";
import { saveProject } from "@features/presentation-workshop/api";

vi.mock("@features/presentation-workshop/api", () => ({
  saveProject: vi.fn(),
  createProject: vi.fn(),
}));
const initial = (): Project => ({
  id: "project",
  title: "测试",
  document: newDeck(),
  revision: 0,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
});
afterEach(() => vi.clearAllMocks());
it("保存中的新编辑不会被旧响应覆盖，排空队列使用新 revision", async () => {
  const project = initial();
  let resolve!: (value: Project) => void;
  vi.mocked(saveProject)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockImplementationOnce(async (_, body, revision) => ({
      ...project,
      ...body,
      revision: revision + 1,
    }));
  const { result } = renderHook(() => usePresentationDraft(project, vi.fn()));
  act(() => result.current.commit((d) => ({ ...d, title: "第一次修改" })));
  let pending!: Promise<Project>;
  act(() => {
    pending = result.current.flush();
  });
  act(() => result.current.commit((d) => ({ ...d, title: "第二次修改" })));
  await act(async () => {
    resolve({ ...project, title: "第一次修改", revision: 1 });
    const simultaneous = [result.current.flush(), result.current.flush()];
    await Promise.all([pending, ...simultaneous]);
  });
  expect(result.current.draft.title).toBe("第二次修改");
  expect(result.current.state).toBe("saved");
  expect(vi.mocked(saveProject).mock.calls[1][2]).toBe(1);
  expect(saveProject).toHaveBeenCalledTimes(2);
});
it("统一历史跨文字与图形操作撤销重做", () => {
  const { result } = renderHook(() => usePresentationDraft(initial(), vi.fn()));
  act(() => result.current.commit((d) => ({ ...d, title: "文字" }), "text"));
  act(() =>
    result.current.commit((d) => ({
      ...d,
      document: {
        ...d.document,
        slides: d.document.slides.map((s) => ({ ...s, background: "#111111" })),
      },
    })),
  );
  act(() => result.current.undo());
  expect(result.current.draft.document.slides[0].background).toBe("#132338");
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("测试");
  act(() => result.current.redo());
  expect(result.current.draft.title).toBe("文字");
});
it("冲突保留草稿并阻止自动覆盖", async () => {
  const project = initial();
  vi.mocked(saveProject).mockRejectedValue(
    new ApiError("冲突", { current: { ...project, revision: 3 } }, 409),
  );
  const { result } = renderHook(() => usePresentationDraft(project, vi.fn()));
  act(() => result.current.commit((d) => ({ ...d, title: "本地草稿" })));
  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow("冲突");
  });
  expect(result.current.state).toBe("conflict");
  expect(result.current.draft.title).toBe("本地草稿");
  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow("处理保存冲突");
  });
  expect(saveProject).toHaveBeenCalledTimes(1);
});
