import { useState } from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  ModelCatalogEditor,
  type ModelCatalogActions,
  type ModelCatalogValue,
} from "@features/models/catalog";
import {
  catalogRows,
  filterCatalogRows,
  modelTestMode,
} from "@features/models/catalog/catalogPresentation";
import type { ModelCategory } from "@features/models/api";

const categories: ModelCategory[] = [
  { id: "text_generation", label: "文本生成", type: "text" },
  { id: "image_generation", label: "图片生成", type: "image" },
  { id: "music_generation", label: "音乐生成", type: "audio" },
];
function value(): ModelCatalogValue {
  return {
    suppliers: [
      { id: "s1", name: "SenseAudio" },
      { id: "s2", name: "自建服务" },
    ],
    providers: [
      {
        id: "p1",
        supplier_id: "s1",
        name: "通用网关",
        kind: "openai",
        base_url: "https://example.test/v1",
        enabled: true,
        has_api_key: true,
        api_key_hint: "1234",
        models: [
          {
            id: "m1",
            provider_id: "p1",
            slug: "vl",
            label: "视觉对话",
            description: "",
            capabilities: ["chat", "vision", "tools"],
            categories: ["text_generation"],
            enabled: true,
          },
          {
            id: "m2",
            provider_id: "p1",
            slug: "multi",
            label: "多用途",
            description: "",
            capabilities: ["chat", "image_generation"],
            categories: ["text_generation", "image_generation"],
            enabled: false,
          },
        ],
      },
      {
        id: "p2",
        supplier_id: "s2",
        name: "图片接口",
        kind: "senseaudio_image",
        base_url: "",
        enabled: false,
        has_api_key: false,
        api_key_hint: "",
        models: [
          {
            id: "m3",
            provider_id: "p2",
            slug: "image",
            label: "多用途",
            description: "",
            capabilities: ["image_generation"],
            categories: ["image_generation"],
            enabled: true,
          },
        ],
      },
      {
        id: "p3",
        name: "音乐接口",
        kind: "senseaudio_music",
        base_url: "",
        enabled: true,
        has_api_key: false,
        api_key_hint: "",
        models: [
          {
            id: "m4",
            provider_id: "p3",
            slug: "music",
            label: "音乐模型",
            description: "",
            capabilities: ["audio_generation"],
            categories: ["music_generation"],
            enabled: true,
          },
        ],
      },
    ],
  };
}
function actions(): ModelCatalogActions {
  return {
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deleteSupplier: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    setProviderEnabled: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    setModelEnabled: vi.fn(),
  };
}
function renderEditor(data = value(), callbacks = actions(), canWrite = true) {
  return {
    callbacks,
    ...render(
      <ModelCatalogEditor
        value={data}
        categories={categories}
        actions={callbacks}
        permissions={{ canWrite, canTest: true }}
        onTestModel={vi.fn()}
      />,
    ),
  };
}

describe("model directory", () => {
  test("separates image understanding from generation and keeps model identity across filters", () => {
    const rows = catalogRows(value());
    const filtered = filterCatalogRows(rows, categories, {
      tab: "image",
      search: "",
      supplier: "",
      capability: "",
    });
    expect(filtered.map((row) => row.model.id)).toEqual(["m2", "m3"]);
    expect(
      filterCatalogRows(rows, categories, {
        tab: "all",
        search: "VL",
        supplier: "s1",
        capability: "vision",
      }).map((row) => row.model.id),
    ).toEqual(["m1"]);
    expect(modelTestMode(rows[3].model, rows[3].provider)).toBeNull();
  });

  test("starts in the directory, filters suppliers and distinguishes connection status", async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(screen.getByRole("tab", { name: "模型目录" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("连接已停用")).toBeInTheDocument();
    expect(screen.getByText("模型已停用")).toBeInTheDocument();
    expect(screen.getByText("暂不支持测试")).toBeInTheDocument();
    expect(screen.queryByText("API Key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "图片" }));
    expect(screen.queryByText("视觉对话")).not.toBeInTheDocument();
    expect(screen.getAllByText("多用途")).toHaveLength(2);
    await user.click(screen.getByRole("combobox", { name: "筛选供应商" }));
    await user.click(screen.getByRole("option", { name: "自建服务" }));
    expect(screen.getAllByText("多用途")).toHaveLength(1);
    expect(screen.getByText("1 个模型")).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "搜索模型" }),
      "missing",
    );
    expect(screen.getByText("没有匹配的模型")).toBeInTheDocument();
  });

  test("read-only users retain the directory and connection tree without write actions", async () => {
    const user = userEvent.setup();
    renderEditor(value(), actions(), false);
    expect(
      screen.queryByRole("button", { name: "添加模型" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "视觉对话 操作" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "接入管理" }));
    expect(screen.getByRole("button", { name: /SenseAudio/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "添加供应商" }),
    ).not.toBeInTheDocument();
  });

  test("shows source fields only in connection configuration and supports regrouping", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderEditor();
    await user.click(screen.getByRole("tab", { name: "接入管理" }));
    expect(screen.queryByText("API Key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "连接配置" }));
    expect(screen.getByText("已配置 ···· 1234")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑连接" }));
    const dialog = screen.getByRole("dialog", { name: "编辑接入连接" });
    await user.click(
      within(dialog).getByRole("combobox", { name: "所属供应商" }),
    );
    await user.click(screen.getByRole("option", { name: "未分组" }));
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(callbacks.updateProvider).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ supplier_id: null, api_key: "" }),
    );
  });

  test("save failures retain input and the same editor supports a template draft without workspace requests", async () => {
    const user = userEvent.setup();
    const callbacks = actions();
    vi.mocked(callbacks.updateModel).mockRejectedValueOnce(
      new Error("目录已更新，请核对"),
    );
    renderEditor(value(), callbacks);
    await user.click(screen.getByRole("button", { name: "视觉对话 操作" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑 视觉对话" }));
    await user.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await user.type(
      screen.getByRole("textbox", { name: "显示名称" }),
      "保留草稿",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目录已更新");
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue(
      "保留草稿",
    );
    expect(
      screen.getByRole("dialog", { name: "编辑模型" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(callbacks.updateModel).toHaveBeenLastCalledWith(
      "m1",
      expect.objectContaining({ label: "保留草稿" }),
    );
  });

  test("locks managed fields but template callers can explicitly edit them", async () => {
    const user = userEvent.setup();
    const data = value();
    data.providers[0].origin = "role_template";
    data.providers[0].managed_fields = [
      "name",
      "kind",
      "base_url",
      "api_key",
      "supplier_id",
    ];
    const callbacks = actions();
    const { rerender } = renderEditor(data, callbacks);
    await user.click(screen.getByRole("tab", { name: "接入管理" }));
    await user.click(screen.getByRole("tab", { name: "连接配置" }));
    await user.click(screen.getByRole("button", { name: "编辑连接" }));
    expect(screen.getByRole("textbox", { name: "服务地址" })).toBeDisabled();
    expect(screen.getByLabelText("API Key")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    rerender(
      <ModelCatalogEditor
        value={data}
        categories={categories}
        actions={callbacks}
        permissions={{
          canWrite: true,
          canEditField: () => true,
          canDelete: () => true,
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "编辑连接" }));
    expect(screen.getByRole("textbox", { name: "服务地址" })).toBeEnabled();
  });

  test("copying a connection clears secrets and does not change the source", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderEditor();
    await user.click(screen.getByRole("tab", { name: "接入管理" }));
    await user.click(screen.getByRole("tab", { name: "连接配置" }));
    await user.click(screen.getByRole("button", { name: "复制为自建连接" }));
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(callbacks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ api_key: "", name: "通用网关 副本" }),
    );
    expect(callbacks.updateProvider).not.toHaveBeenCalled();
  });

  test("updates only caller-owned draft state until the caller saves", async () => {
    const user = userEvent.setup();
    const callbacks = actions();
    function Draft() {
      const [data, setData] = useState(value());
      return (
        <ModelCatalogEditor
          value={data}
          categories={categories}
          permissions={{ canWrite: true }}
          actions={{
            ...callbacks,
            createSupplier: (input) =>
              setData((old) => ({
                ...old,
                suppliers: [...old.suppliers, { id: "new", name: input.name }],
              })),
          }}
        />
      );
    }
    render(<Draft />);
    await user.click(screen.getByRole("tab", { name: "接入管理" }));
    await user.click(screen.getByRole("button", { name: "添加供应商" }));
    await user.type(
      screen.getByRole("textbox", { name: "供应商名称" }),
      "模板草稿供应商",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("模板草稿供应商")).toBeInTheDocument();
    expect(callbacks.createSupplier).not.toHaveBeenCalled();
  });
});

test("keyboard navigation switches tabs and restores row focus after Escape", async () => {
  const user = userEvent.setup();
  renderEditor();
  screen.getByRole("tab", { name: "模型目录" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "接入管理" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "接入管理" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.keyboard("{Home}");
  const trigger = screen.getByRole("button", { name: "视觉对话 操作" });
  await user.click(trigger);
  expect(screen.getByRole("menuitem", { name: "编辑 视觉对话" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "删除 视觉对话" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("refresh preserves failed drafts and deleted models cannot be saved", async () => {
  const user = userEvent.setup();
  const callbacks = actions();
  vi.mocked(callbacks.updateModel).mockRejectedValueOnce(
    new Error("目录版本冲突"),
  );
  const refresh = vi.fn();
  const data = value();
  const props = {
    value: data,
    categories,
    actions: callbacks,
    permissions: { canWrite: true },
    onRefresh: refresh,
  };
  const { rerender } = render(<ModelCatalogEditor {...props} />);
  await user.click(screen.getByRole("button", { name: "视觉对话 操作" }));
  await user.click(screen.getByRole("menuitem", { name: "编辑 视觉对话" }));
  const field = screen.getByRole("textbox", { name: "显示名称" });
  await user.clear(field);
  await user.type(field, "我的草稿");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await user.click(await screen.findByRole("button", { name: "刷新核对" }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(field).toHaveValue("我的草稿");
  const changed = value();
  changed.providers[0].models = [];
  rerender(<ModelCatalogEditor {...props} value={changed} />);
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(field).toHaveValue("我的草稿");
  expect(
    screen.getAllByRole("alert").some((el) => el.textContent?.includes("删除")),
  ).toBe(true);
});

test("permission changes disable an open form without discarding its input", async () => {
  const user = userEvent.setup();
  const data = value();
  const callbacks = actions();
  const { rerender } = renderEditor(data, callbacks);
  await user.click(screen.getByRole("button", { name: "视觉对话 操作" }));
  await user.click(screen.getByRole("menuitem", { name: "编辑 视觉对话" }));
  await user.type(screen.getByRole("textbox", { name: "显示名称" }), " 草稿");
  rerender(
    <ModelCatalogEditor
      value={data}
      categories={categories}
      actions={callbacks}
      permissions={{ canWrite: false }}
    />,
  );
  expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue(
    "视觉对话 草稿",
  );
  expect(screen.getByRole("textbox", { name: "显示名称" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(callbacks.updateModel).not.toHaveBeenCalled();
});
