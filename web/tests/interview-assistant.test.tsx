import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InterviewAssistantPage } from "@features/interview-assistant/InterviewAssistantPage";
import {
  interviewApi,
  type Room,
  type PrepareInput,
} from "@features/interview-assistant/api";
import type { NavigationGuard } from "@features/interview-assistant/types";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { APPLICATION_DEFINITIONS } from "@app/applicationRegistry";
import { interviewRoom, interviewTask } from "./helpers/interview";

vi.mock("@features/interview-assistant/api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@features/interview-assistant/api")>();
  return {
    ...actual,
    interviewApi: {
      executor: vi.fn(),
      rooms: vi.fn(),
      room: vi.fn(),
      create: vi.fn(),
      upload: vi.fn(),
      prepare: vi.fn(),
      cancel: vi.fn(),
      remove: vi.fn(),
      bundle: vi.fn(),
      export: vi.fn(),
      progress: vi.fn(),
    },
  };
});
let saved: Room | null;
beforeEach(() => {
  saved = null;
  vi.mocked(interviewApi.executor).mockResolvedValue({
    available: true,
    code: "ready",
    message: "本机 Codex 可用",
    version: "0.163.0",
  });
  vi.mocked(interviewApi.rooms).mockImplementation(async () => ({
    items: saved ? [saved] : [],
  }));
  vi.mocked(interviewApi.room).mockImplementation(async () => saved!);
  vi.mocked(interviewApi.progress).mockImplementation(
    async () => saved!.tasks[0],
  );
  vi.mocked(interviewApi.create).mockImplementation(async (title) => {
    saved = { ...interviewRoom(), title };
    return saved;
  });
  vi.mocked(interviewApi.prepare).mockImplementation(
    async (_id, body: PrepareInput) => {
      const task = {
        ...interviewTask(),
        snapshot: {
          ...body,
          material: body.material_id
            ? { id: body.material_id, filename: "resume.docx", sha256: "hash" }
            : null,
        },
      };
      saved = {
        ...saved!,
        revision: saved!.revision + 1,
        input_version: 1,
        active_task_id: task.id,
        active_bundle_id: task.id,
        tasks: [task],
      };
      return saved;
    },
  );
  vi.mocked(interviewApi.upload).mockImplementation(async (room) => {
    saved = {
      ...room,
      revision: room.revision + 1,
      materials: [
        {
          id: "material-1",
          filename: "resume.docx",
          sha256: "hash",
          size: 100,
          created_at: "2026-10-22T00:00:00Z",
        },
      ],
    };
    return saved;
  });
  vi.mocked(interviewApi.cancel).mockImplementation(async () => {
    saved = { ...saved!, tasks: [{ ...saved!.tasks[0], status: "cancelled" }] };
    return saved;
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
function page(
  register: (guard: NavigationGuard | null) => void = vi.fn(),
  scope = "user:workspace",
) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <InterviewAssistantPage
        scopeKey={scope}
        registerNavigationGuard={register}
      />
    </QueryClientProvider>,
  );
}
async function ready() {
  await screen.findByRole("textbox", { name: "岗位名称" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "调研并准备" })).toBeEnabled(),
  );
}
async function enter() {
  fireEvent.click(screen.getByRole("button", { name: "调研并准备" }));
  await screen.findByRole("heading", { name: "资料已就绪" });
  fireEvent.click(
    await screen.findByRole("button", { name: "检查设备并进入面试" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "准备好了，开始面试" }));
}

test("application search, category and recent access expose the integrated assistant", () => {
  const open = vi.fn();
  render(
    <ApplicationCenterPage
      applications={APPLICATION_DEFINITIONS}
      onOpen={open}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "效率协作" }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索应用" }), {
    target: { value: "简历" },
  });
  fireEvent.click(screen.getByRole("button", { name: "打开面试助手" }));
  expect(open).toHaveBeenCalledWith("/apps/interview-assistant");
  expect(localStorage.getItem("future-props-recent-applications")).toContain(
    "interview-assistant",
  );
});

test("custom inputs are submitted unchanged, and the real blueprint drives practice and review", async () => {
  page();
  await ready();
  fireEvent.change(screen.getByRole("textbox", { name: "岗位名称" }), {
    target: { value: "自定义岗位" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /岗位描述/ }), {
    target: { value: "自定义 React JD" },
  });
  await enter();
  expect(interviewApi.prepare).toHaveBeenCalledWith(
    "room-1",
    expect.objectContaining({ role: "自定义岗位", jd: "自定义 React JD" }),
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "真实蓝图问题 2",
  );
  fireEvent.change(screen.getByRole("textbox", { name: /你的回答/ }), {
    target: { value: "我负责键盘交互，通过独立样本验证。" },
  });
  fireEvent.click(screen.getByRole("button", { name: "暂停" }));
  expect(screen.getByRole("textbox", { name: /你的回答/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "继续面试" }));
  fireEvent.click(screen.getByRole("button", { name: "结束面试" }));
  fireEvent.click(screen.getByRole("button", { name: "结束并生成复盘" }));
  await screen.findByRole("heading", { name: "面试复盘" });
  expect(
    screen.getAllByText("我负责键盘交互，通过独立样本验证。").length,
  ).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "只练这一题" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("共 1 道练习题");
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  expect(screen.getByRole("heading", { name: "面试复盘" })).toBeVisible();
});

test("PDF/DOCX originals are passed to the API without requiring a pasted summary", async () => {
  page();
  await ready();
  const file = new File(["fictional"], "resume.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  fireEvent.change(screen.getByLabelText("选择简历文件"), {
    target: { files: [file] },
  });
  expect(screen.getByRole("textbox", { name: "简历摘要" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "调研并准备" }));
  await screen.findByRole("heading", { name: "资料已就绪" });
  expect(interviewApi.upload).toHaveBeenCalledWith(expect.anything(), file);
  expect(interviewApi.prepare).toHaveBeenCalledWith(
    "room-1",
    expect.objectContaining({ material_id: "material-1", resume: "" }),
  );
});

test("saved preparation is restored without a dirty guard; unsaved edits trigger navigation protection", async () => {
  saved = interviewRoom(interviewTask());
  let guard: NavigationGuard | null = null;
  const register = (next: NavigationGuard | null) => {
    guard = next;
  };
  const view = page(register);
  await screen.findByRole("heading", { name: "资料已就绪" });
  expect(guard).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "网络来源" }));
  expect(screen.getByRole("link", { name: /test-1/ })).toHaveAttribute(
    "href",
    "https://www.w3.org/WAI/test-1",
  );
  fireEvent.click(screen.getByRole("button", { name: "修改材料" }));
  fireEvent.change(screen.getByRole("textbox", { name: "岗位名称" }), {
    target: { value: "changed" },
  });
  const next = vi.fn();
  act(() => {
    guard!(next);
  });
  expect(await screen.findByRole("alertdialog")).toHaveTextContent(
    "已提交的资料和后台任务会保留",
  );
  fireEvent.click(screen.getByRole("button", { name: "留在当前页面" }));
  expect(next).not.toHaveBeenCalled();
  view.unmount();
  saved = null;
  page(vi.fn(), "different-user:workspace");
  await ready();
  expect(screen.getByRole("textbox", { name: "岗位名称" })).toHaveValue(
    "AI 应用工程师",
  );
});

test("real running tasks can be cancelled and failures can be retried without fabricated readiness", async () => {
  saved = interviewRoom(interviewTask("running"));
  page();
  await screen.findByRole("heading", { name: "Codex 准备中" });
  expect(
    screen.queryByRole("button", { name: "检查设备并进入面试" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消准备" }));
  await screen.findByRole("heading", { name: "已取消" });
  fireEvent.click(screen.getByRole("button", { name: "重新准备一个版本" }));
  await screen.findByRole("heading", { name: "资料已就绪" });
  expect(interviewApi.cancel).toHaveBeenCalledOnce();
  expect(interviewApi.prepare).toHaveBeenCalledOnce();
});

test("empty practice review has no invented answer evaluation", async () => {
  page();
  await ready();
  await enter();
  fireEvent.click(screen.getByRole("button", { name: "结束面试" }));
  fireEvent.click(screen.getByRole("button", { name: "结束并生成复盘" }));
  await screen.findByRole("heading", { name: "面试复盘" });
  expect(screen.getByText(/已回答 0 \/ 3 题/)).toBeVisible();
  expect(
    screen.queryByText("补充具体过程，让结论更有依据"),
  ).not.toBeInTheDocument();
});
