import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@platform/api/client";
import { newDeck, newSlide } from "@features/presentation-workshop/templates";
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
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
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
  expect(result.current.draft.document.slides[0].background).toBe("#142D40");
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

it("同字段按时间合并，失焦边界、无效修改与重做分支独立", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => usePresentationDraft(initial(), vi.fn()));
  const title = (value: string) =>
    act(() => result.current.commit((d) => ({ ...d, title: value }), "title"));
  title("a");
  title("ab");
  act(() => result.current.commit((d) => ({ ...d })));
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("测试");
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.redo());
  act(() => result.current.endGroup());
  title("abc");
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("ab");
  title("新分支");
  expect(result.current.canRedo).toBe(false);
  act(() => {
    vi.setSystemTime(Date.now() + 801);
  });
  title("停顿后");
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("新分支");
});

it("输入法与长滑杆手势各合并为一步，组合期间不能撤销", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => usePresentationDraft(initial(), vi.fn()));
  act(() => result.current.setComposition(true));
  act(() => result.current.commit((d) => ({ ...d, title: "中" }), "title"));
  act(() => {
    vi.setSystemTime(Date.now() + 2000);
  });
  act(() => result.current.commit((d) => ({ ...d, title: "中文" }), "title"));
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("中文");
  act(() => result.current.setComposition(false));
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("测试");
  act(() => result.current.setContinuous(true));
  act(() => result.current.commit((d) => ({ ...d, title: "1" }), "range"));
  act(() => {
    vi.setSystemTime(Date.now() + 2000);
  });
  act(() => result.current.commit((d) => ({ ...d, title: "2" }), "range"));
  act(() => result.current.setContinuous(false));
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("测试");
});

it("最多保留100步，载入服务器版本清空历史与分组", () => {
  const project = initial();
  const { result } = renderHook(() => usePresentationDraft(project, vi.fn()));
  for (let i = 1; i <= 105; i++)
    act(() => result.current.commit((d) => ({ ...d, title: String(i) })));
  for (let i = 0; i < 100; i++) act(() => result.current.undo());
  expect(result.current.draft.title).toBe("5");
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.adopt({ ...project, revision: 3 }));
  expect(result.current.canUndo).toBe(false);
  expect(result.current.canRedo).toBe(false);
});

it("跨页历史记录受影响页，删除后的定位回退到相邻页面", () => {
  const project = initial();
  const second = newSlide("blank");
  project.document.slides.push(second);
  const { result } = renderHook(() => usePresentationDraft(project, vi.fn()));
  const location = { slideId: second.id, slideIndex: 1, selected: [] };
  act(() =>
    result.current.commit(
      (d) => ({
        ...d,
        document: {
          ...d.document,
          slides: d.document.slides.filter((s) => s.id !== second.id),
        },
      }),
      "",
      location,
    ),
  );
  let restored;
  act(() => {
    restored = result.current.undo();
  });
  expect(restored).toEqual(location);
  act(() => {
    restored = result.current.redo();
  });
  expect(restored).toMatchObject({
    slideId: project.document.slides[0].id,
    slideIndex: 0,
  });
});

it("保存中撤销使用下一 revision 保存恢复结果，保存后保留历史", async () => {
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
  act(() => result.current.commit((d) => ({ ...d, title: "保存中" })));
  let pending!: Promise<Project>;
  act(() => {
    pending = result.current.flush();
  });
  act(() => result.current.undo());
  await act(async () => {
    resolve({ ...project, title: "保存中", revision: 1 });
    await pending;
  });
  expect(vi.mocked(saveProject).mock.calls[1]).toEqual([
    project.id,
    { title: project.title, document: project.document },
    1,
  ]);
  expect(result.current.state).toBe("saved");
  expect(result.current.canRedo).toBe(true);
  act(() => result.current.redo());
  expect(result.current.draft.title).toBe("保存中");
});

it("保存失败与冲突保留可回退草稿，撤销不解除冲突锁", async () => {
  const project = initial();
  vi.mocked(saveProject)
    .mockRejectedValueOnce(new Error("断网"))
    .mockRejectedValueOnce(
      new ApiError("冲突", { current: { ...project, revision: 4 } }, 409),
    );
  const { result } = renderHook(() => usePresentationDraft(project, vi.fn()));
  act(() => result.current.commit((d) => ({ ...d, title: "本地" })));
  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow("断网");
  });
  act(() => result.current.undo());
  expect(result.current.draft.title).toBe("测试");
  act(() => result.current.redo());
  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow("冲突");
  });
  act(() => result.current.undo());
  expect(result.current.state).toBe("conflict");
  expect(result.current.draft.title).toBe("测试");
  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow("处理保存冲突");
  });
  expect(saveProject).toHaveBeenCalledTimes(2);
});
