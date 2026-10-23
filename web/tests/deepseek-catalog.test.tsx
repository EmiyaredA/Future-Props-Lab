import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ProviderForm, ModelForm } from "@features/models/catalog/CatalogForms";
import { modelTestMode } from "@features/models/catalog/catalogPresentation";
import type {
  CatalogProvider,
  ModelCatalogActions,
} from "@features/models/catalog/catalogTypes";
import { logProviderKindOptions } from "@features/models/logs/logOptions";
import { ProviderIcon } from "@shared/ui/ProviderIcon";

const provider: CatalogProvider = {
  id: "deepseek",
  name: "DeepSeek 官方",
  kind: "deepseek",
  base_url: "https://api.deepseek.com",
  enabled: true,
  has_api_key: true,
  api_key_hint: "1234",
  models: [],
};

function props() {
  const actions: ModelCatalogActions = {
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    setProviderEnabled: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    setModelEnabled: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deleteSupplier: vi.fn(),
  };
  return {
    value: { suppliers: [], providers: [provider] },
    actions,
    permissions: { canWrite: true },
    categories: [
      {
        id: "text_generation" as const,
        label: "文本生成",
        type: "text" as const,
      },
    ],
    onClose: vi.fn(),
    onRefresh: vi.fn(),
  };
}

describe("DeepSeek catalog", () => {
  test("connection option explains the official default and saves via the existing action", async () => {
    const user = userEvent.setup();
    const shared = props();
    render(<ProviderForm {...shared} initial={null} />);
    await user.type(
      screen.getByRole("textbox", { name: "连接名称" }),
      "DeepSeek",
    );
    await user.click(screen.getByRole("combobox", { name: "接入协议" }));
    await user.click(screen.getByRole("option", { name: "DeepSeek 官方" }));
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveAttribute(
      "placeholder",
      "https://api.deepseek.com",
    );
    expect(screen.getByText(/当前接入使用非思考模式/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("API Key"), "test-key");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(shared.actions.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "DeepSeek",
        kind: "deepseek",
        base_url: "",
        api_key: "test-key",
      }),
    );
  });

  test.each([
    [
      "DeepSeek Flash · 支持图像理解",
      "deepseek-flash",
      "DeepSeek Flash",
      ["chat", "tools", "vision"],
    ],
    [
      "DeepSeek V4 Pro",
      "deepseek-v4-pro",
      "DeepSeek V4 Pro",
      ["chat", "tools"],
    ],
  ] as const)(
    "preset %s fills only its supported capabilities",
    async (option, slug, label, capabilities) => {
      const user = userEvent.setup();
      const shared = props();
      render(<ModelForm {...shared} initial={null} providerId="deepseek" />);
      await user.click(
        screen.getByRole("combobox", { name: "DeepSeek 模型预设" }),
      );
      await user.click(screen.getByRole("option", { name: option }));
      expect(screen.getByRole("textbox", { name: "模型标识" })).toHaveValue(
        slug,
      );
      expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue(
        label,
      );
      const group = screen.getByRole("group", { name: "支持能力" });
      expect(
        within(group).getByRole("button", { name: "图像理解" }),
      ).toHaveAttribute(
        "aria-pressed",
        capabilities.some((capability) => capability === "vision")
          ? "true"
          : "false",
      );
      await user.click(screen.getByRole("button", { name: "保存" }));
      expect(shared.actions.createModel).toHaveBeenCalledWith(
        "deepseek",
        expect.objectContaining({
          slug,
          label,
          capabilities: [...capabilities],
          categories: ["text_generation"],
        }),
      );
    },
  );

  test("switching from Flash to Pro removes vision and custom IDs remain editable", async () => {
    const user = userEvent.setup();
    render(<ModelForm {...props()} initial={null} providerId="deepseek" />);
    for (const name of ["DeepSeek Flash · 支持图像理解", "DeepSeek V4 Pro"]) {
      await user.click(
        screen.getByRole("combobox", { name: "DeepSeek 模型预设" }),
      );
      await user.click(screen.getByRole("option", { name }));
    }
    expect(screen.getByRole("button", { name: "图像理解" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.clear(screen.getByRole("textbox", { name: "模型标识" }));
    await user.type(
      screen.getByRole("textbox", { name: "模型标识" }),
      "custom-deepseek-model",
    );
    expect(screen.getByRole("textbox", { name: "模型标识" })).toHaveValue(
      "custom-deepseek-model",
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  });

  test("text testing and log filtering accept the independent provider kind", () => {
    expect(
      modelTestMode(
        {
          id: "flash",
          provider_id: "deepseek",
          slug: "deepseek-flash",
          label: "Flash",
          description: "",
          enabled: true,
          capabilities: ["chat", "tools", "vision"],
          categories: ["text_generation"],
        },
        provider,
      ),
    ).toBe("chat");
    expect(logProviderKindOptions).toContainEqual({
      value: "deepseek",
      label: "DeepSeek 官方",
    });
  });

  test("Qwen and DeepSeek use packaged brand artwork at the requested size", () => {
    const { container } = render(
      <>
        <ProviderIcon kind="local_qwen_tts" size={30} />
        <ProviderIcon kind="deepseek" size={20} />
      </>,
    );
    const images = container.querySelectorAll("img");
    expect(images[0]).toHaveAttribute("src", "/providers/qwen-logo.svg");
    expect(images[0]).toHaveAttribute("width", "30");
    expect(images[1]).toHaveAttribute("src", "/providers/deepseek-logo.svg");
    expect(images[1]).toHaveAttribute("width", "20");
    expect(container.querySelector("svg")).toBeNull();
  });
});
