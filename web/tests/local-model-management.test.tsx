import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LocalModelsPanel } from "@features/models/catalog/LocalModelsPanel";
import { ModelCatalogEditor } from "@features/models/catalog/ModelCatalogEditor";
import type { ModelCatalogActions } from "@features/models/catalog/catalogTypes";
import type { Catalog } from "@features/models/api";
import * as localApi from "@features/models/localModelApi";
import { modelQueryKeys } from "@features/models/queryKeys";
import { ApiError } from "@platform/api/client";

vi.mock("@features/models/localModelApi", () => ({
  getLocalModels: vi.fn(),
  localModelAction: vi.fn(),
  attachLocalModel: vi.fn(),
}));
const item: localApi.LocalModel = {
  id: "qwen3-tts-0.6b-base",
  label: "Qwen3-TTS 0.6B Base",
  repository: "mlx-community/test",
  license: "Apache-2.0",
  model_revision: "fixed",
  download_bytes: 2520000000,
  required_disk_bytes: 7200000000,
  compatible: true,
  status: "not_installed",
  enabled: false,
  loaded: false,
  busy: false,
  progress: 0,
  revision: 0,
};
const second = {
  ...item,
  id: "qwen3-tts-1.7b-base",
  label: "Qwen3-TTS 1.7B Base",
  download_bytes: 4540000000,
  required_disk_bytes: 11200000000,
};
const emptyCatalog: Catalog = {
  revision: 7,
  suppliers: [],
  providers: [],
  default_model_ids: { chat: "existing-default" },
};
function attachedCatalog(providerEnabled = true, modelEnabled = true): Catalog {
  return {
    ...emptyCatalog,
    revision: 8,
    providers: [
      {
        id: "p",
        name: "本地 Qwen 语音",
        kind: "local_qwen_tts",
        origin: "user",
        base_url: "",
        enabled: providerEnabled,
        has_api_key: false,
        api_key_hint: "",
        models: [
          {
            id: "m",
            provider_id: "p",
            slug: item.id,
            label: item.label,
            description: "",
            origin: "user",
            enabled: modelEnabled,
            availability: "ready",
            capabilities: ["speech_synthesis"],
            categories: ["speech_synthesis"],
          },
        ],
      },
    ],
  };
}
let state: localApi.LocalModel[];
let canManage: boolean;
const clients: QueryClient[] = [];
const onTestModel = vi.fn();
const onOpenConnection = vi.fn();
function mount(
  options: {
    catalog?: Catalog;
    canWrite?: boolean;
    allowHostManagement?: boolean;
    canTest?: boolean;
    editor?: boolean;
    slot?: boolean;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  function Connected() {
    const catalog = useQuery({
      queryKey: modelQueryKeys.catalog,
      initialData: options.catalog ?? emptyCatalog,
      queryFn: async () =>
        client.getQueryData<Catalog>(modelQueryKeys.catalog)!,
    }).data;
    const panel = (open: (providerId: string) => void = onOpenConnection) => (
      <LocalModelsPanel
        catalog={catalog}
        allowHostManagement={options.allowHostManagement ?? true}
        canWrite={options.canWrite ?? true}
        canTest={options.canTest ?? true}
        onTestModel={onTestModel}
        onOpenConnection={open}
      />
    );
    return options.editor ? (
      <ModelCatalogEditor
        value={{ ...catalog, suppliers: catalog.suppliers ?? [] }}
        categories={[]}
        actions={{} as ModelCatalogActions}
        permissions={{ canWrite: false }}
        renderLocalModels={options.slot === false ? undefined : panel}
      />
    ) : (
      panel()
    );
  }
  const result = render(
    <QueryClientProvider client={client}>
      <Connected />
    </QueryClientProvider>,
  );
  return { ...result, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  state = [{ ...item }];
  canManage = true;
  vi.mocked(localApi.getLocalModels).mockImplementation(async () => ({
    can_manage: canManage,
    items: state,
  }));
  vi.mocked(localApi.localModelAction).mockImplementation(
    async (model, action) => {
      const updated = {
        ...model,
        revision: model.revision + 1,
        ...(action === "install"
          ? { status: "installing", progress: 17 }
          : action === "cancel"
            ? { status: "cancelled", enabled: false }
            : action === "uninstall"
              ? { status: "not_installed", enabled: false }
              : { enabled: action === "enable" }),
      };
      state = state.map((entry) => (entry.id === model.id ? updated : entry));
      return updated;
    },
  );
  vi.mocked(localApi.attachLocalModel).mockResolvedValue(attachedCatalog());
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.useRealTimers();
});

test("catalog remains default and local management exists only when a slot is supplied", async () => {
  const user = userEvent.setup();
  const result = mount({ editor: true });
  expect(screen.getByRole("tab", { name: "模型目录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(localApi.getLocalModels).not.toHaveBeenCalled();
  const directory = screen.getByRole("tab", { name: "模型目录" });
  directory.focus();
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "本地模型" })).toHaveFocus();
  await screen.findByRole("radio", { name: item.label });
  expect(localApi.localModelAction).not.toHaveBeenCalled();
  result.unmount();
  mount({ editor: true, slot: false });
  expect(
    within(screen.getByRole("tablist", { name: "模型服务视图" })).getAllByRole(
      "tab",
    ),
  ).toHaveLength(2);
});

test("leaving local models unmounts polling without cancelling an installation", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mount({ editor: true });
  await userEvent.click(screen.getByRole("tab", { name: "本地模型" }));
  await screen.findByRole("radio", { name: item.label });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(localApi.getLocalModels).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("tab", { name: "模型目录" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(localApi.getLocalModels).toHaveBeenCalledTimes(2);
  expect(localApi.localModelAction).not.toHaveBeenCalled();
});

test("selecting a model changes details and keeps installation opt-in", async () => {
  state = [item, second];
  mount();
  expect(await screen.findByRole("radio", { name: item.label })).toBeChecked();
  expect(localApi.localModelAction).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("radio", { name: second.label }));
  expect(
    screen.getByRole("heading", { name: second.label }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "下载安装" }));
  await waitFor(() =>
    expect(localApi.localModelAction).toHaveBeenCalledWith(second, "install"),
  );
  expect(await screen.findByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "17",
  );
  expect(localApi.attachLocalModel).not.toHaveBeenCalled();
});

test("install can be cancelled and explicitly retried, then automatically enables", async () => {
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "下载安装" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "取消安装" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "重试安装" }),
  );
  state = [{ ...state[0], status: "installed", enabled: true, progress: 100 }];
  await act(async () => {
    await clients[0].invalidateQueries({
      queryKey: modelQueryKeys.localModels,
    });
  });
  expect(
    await screen.findByRole("button", { name: "添加到当前空间" }),
  ).toBeEnabled();
  expect(screen.queryByRole("button", { name: "启用服务" })).toBeNull();
  expect(localApi.localModelAction).toHaveBeenCalledTimes(3);
});

test("adding uses current revision, updates the catalog, preserves defaults and leads to testing", async () => {
  state = [{ ...item, status: "installed", enabled: true }];
  const { client } = mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "添加到当前空间" }),
  );
  await waitFor(() =>
    expect(localApi.attachLocalModel).toHaveBeenCalledWith(item.id, 7),
  );
  await userEvent.click(await screen.findByRole("button", { name: "去测试" }));
  expect(onTestModel).toHaveBeenCalledWith(
    attachedCatalog().providers[0].models[0],
    attachedCatalog().providers[0],
  );
  expect(
    client.getQueryData<Catalog>(modelQueryKeys.catalog)?.default_model_ids,
  ).toEqual(emptyCatalog.default_model_ids);
  expect(screen.queryByRole("button", { name: "添加到当前空间" })).toBeNull();
});

test.each([
  [false, true],
  [true, false],
])(
  "disabled connection or model routes to connection management (%s/%s)",
  async (provider, model) => {
    state = [{ ...item, status: "installed", enabled: true }];
    mount({ catalog: attachedCatalog(provider, model) });
    await userEvent.click(
      await screen.findByRole("button", { name: "前往接入管理" }),
    );
    expect(onOpenConnection).toHaveBeenCalledWith("p");
    expect(localApi.attachLocalModel).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "去测试" })).toBeNull();
  },
);

test("non-admin space managers may attach an enabled model but cannot manage shared installation", async () => {
  canManage = false;
  state = [{ ...item, status: "installed", enabled: true }];
  mount();
  await screen.findByRole("button", { name: "添加到当前空间" });
  expect(screen.queryByRole("button", { name: "停止服务" })).toBeNull();
  expect(screen.queryByRole("button", { name: /更多操作/ })).toBeNull();
});

test("read-only viewers see why installation and attachment are unavailable", async () => {
  canManage = false;
  const view = mount({ canWrite: false, canTest: false });
  await screen.findByText("安装和运行管理由平台管理员在本机管理端操作。");
  expect(screen.queryByRole("button", { name: "下载安装" })).toBeNull();
  view.unmount();
  state = [{ ...item, status: "installed", enabled: true }];
  mount({ canWrite: false, canTest: false });
  await screen.findByText("添加到当前空间需要工作区配置管理权限。");
  expect(screen.queryByRole("button", { name: "添加到当前空间" })).toBeNull();
});

test("test permission is independent from configuration permission", async () => {
  canManage = false;
  state = [{ ...item, status: "installed", enabled: true }];
  const view = mount({ catalog: attachedCatalog(), canWrite: false });
  await screen.findByRole("button", { name: "去测试" });
  view.unmount();
  mount({ catalog: attachedCatalog(), canWrite: false, canTest: false });
  await screen.findByText("当前角色没有模型测试权限。");
  expect(screen.queryByRole("button", { name: "去测试" })).toBeNull();
});

test("unsupported devices cannot start installation", async () => {
  state = [{ ...item, compatible: false }];
  mount();
  expect(
    await screen.findByRole("button", { name: "下载安装" }),
  ).toBeDisabled();
  expect(
    screen.getByText("需要 macOS 15 或更新版本的 Apple Silicon Mac。"),
  ).toBeInTheDocument();
});

test("stopped service enables without downloading and idle memory is distinct from stopped service", async () => {
  state = [{ ...item, status: "installed" }];
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "启用服务" }),
  );
  await screen.findByRole("button", { name: "添加到当前空间" });
  expect(localApi.localModelAction).toHaveBeenCalledWith(
    expect.objectContaining({ status: "installed" }),
    "enable",
  );
  expect(
    screen.getByText("内存空闲 · 首次调用时加载模型。"),
  ).toBeInTheDocument();
});

test("busy generation disables stop and uninstall", async () => {
  state = [{ ...item, status: "installed", enabled: true, busy: true }];
  mount();
  expect(
    await screen.findByRole("button", { name: "停止服务" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
  expect(screen.getByRole("menuitem", { name: "卸载模型" })).toBeDisabled();
});

test("uninstall requires a project confirmation dialog and retains audio warning", async () => {
  state = [{ ...item, status: "installed", enabled: true }];
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: /更多操作/ }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "卸载模型" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText(/历史音频仍保留/)).toBeInTheDocument();
  expect(localApi.localModelAction).not.toHaveBeenCalled();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "卸载模型" }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(localApi.localModelAction).toHaveBeenCalledWith(
    expect.anything(),
    "uninstall",
  );
});

test("failed downloads can be cleaned up through the existing action", async () => {
  state = [{ ...item, status: "failed", error_message: "连接中断" }];
  mount();
  await screen.findByText("连接中断");
  await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: "清理下载" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "清理下载",
    }),
  );
  await waitFor(() =>
    expect(localApi.localModelAction).toHaveBeenCalledWith(
      expect.anything(),
      "uninstall",
    ),
  );
});

test("revision conflicts refresh state and require an explicit new action", async () => {
  vi.mocked(localApi.localModelAction).mockImplementationOnce(async () => {
    state = [{ ...item, revision: 3 }];
    throw new ApiError("conflict", { code: "revision_conflict" }, 409);
  });
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "下载安装" }),
  );
  await screen.findByText(/请核对最新状态后重新操作/);
  expect(localApi.localModelAction).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "下载安装" }));
  await waitFor(() =>
    expect(localApi.localModelAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 3 }),
      "install",
    ),
  );
});

test("successful action feedback survives a failed refresh and prevents immediate resubmission", async () => {
  vi.mocked(localApi.localModelAction).mockImplementationOnce(async () => {
    vi.mocked(localApi.getLocalModels).mockRejectedValue(
      new Error("网络暂不可用"),
    );
    return { ...item, status: "installing", progress: 3, revision: 1 };
  });
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "下载安装" }),
  );
  await screen.findByText("已开始安装，完成后会自动启用服务。");
  await screen.findByText(/部分状态刷新失败/);
  expect(screen.getByRole("button", { name: "取消安装" })).toBeDisabled();
  expect(localApi.localModelAction).toHaveBeenCalledTimes(1);
});

test("a pending request blocks duplicate submission", async () => {
  let resolve!: (model: localApi.LocalModel) => void;
  vi.mocked(localApi.localModelAction).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  const install = await screen.findByRole("button", { name: "下载安装" });
  await userEvent.dblClick(install);
  expect(localApi.localModelAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "处理中…" })).toBeDisabled();
  await act(async () => resolve(item));
});

test("empty and initial failure states offer an explicit retry", async () => {
  state = [];
  const view = mount();
  await screen.findByRole("heading", { name: "暂无本地模型" });
  view.unmount();
  vi.mocked(localApi.getLocalModels).mockRejectedValueOnce(
    new Error("读取中断"),
  );
  state = [item];
  mount();
  await screen.findByText("读取本地模型失败：读取中断");
  await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByRole("radio", { name: item.label });
});

test("pending writes stay blocked after leaving and reopening the local tab", async () => {
  let finish!: (model: localApi.LocalModel) => void;
  vi.mocked(localApi.localModelAction).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount({ editor: true });
  await userEvent.click(screen.getByRole("tab", { name: "本地模型" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "下载安装" }),
  );
  await userEvent.click(screen.getByRole("tab", { name: "模型目录" }));
  await userEvent.click(screen.getByRole("tab", { name: "本地模型" }));
  expect(await screen.findByRole("button", { name: "处理中…" })).toBeDisabled();
  expect(localApi.localModelAction).toHaveBeenCalledTimes(1);
  await act(async () => finish(item));
});

test("service changes invalidate the directory and inference options", async () => {
  state = [{ ...item, status: "installed", enabled: true }];
  const { client } = mount();
  await screen.findByRole("button", { name: "停止服务" });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await userEvent.click(screen.getByRole("button", { name: "停止服务" }));
  await screen.findByRole("button", { name: "启用服务" });
  expect(invalidate).toHaveBeenCalledWith(
    { queryKey: modelQueryKeys.catalog },
    { throwOnError: true },
  );
  expect(invalidate).toHaveBeenCalledWith(
    { queryKey: modelQueryKeys.inferenceOptions },
    { throwOnError: true },
  );
});

test("late attachment responses cannot repopulate caches after an identity change", async () => {
  state = [{ ...item, status: "installed", enabled: true }];
  let finish!: (catalog: Catalog) => void;
  vi.mocked(localApi.attachLocalModel).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "添加到当前空间" }),
  );
  view.unmount();
  view.client.clear();
  await act(async () => finish(attachedCatalog()));
  expect(view.client.getQueryData(modelQueryKeys.catalog)).toBeUndefined();
  expect(view.client.getQueryData(modelQueryKeys.localModels)).toBeUndefined();
});

test("business model pages hide host installation controls for administrators", async () => {
  mount({ allowHostManagement: false });
  await screen.findByRole("heading", { name: item.label });
  expect(
    screen.queryByRole("button", { name: "下载安装" }),
  ).not.toBeInTheDocument();
});
