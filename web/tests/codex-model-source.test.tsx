import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CodexModelSourcePage } from "@features/tools/CodexModelSourcePage";
import {
  getCodexSource,
  updateCodexSource,
  type CodexSourceState,
} from "@features/tools/api";

vi.mock("@features/tools/api", async () => {
  const actual = await vi.importActual<typeof import("@features/tools/api")>(
    "@features/tools/api",
  );
  return {
    ...actual,
    getCodexSource: vi.fn(),
    updateCodexSource: vi.fn(),
    restoreCodexSource: vi.fn(),
  };
});

const initial: CodexSourceState = {
  config_path: "/tmp/codex-test/config.toml",
  revision: "initial",
  provider: "openai",
  model: "gpt-existing",
  base_url: "",
  env_key: "",
  managed: false,
  backup_available: false,
};

test("applies a custom Codex source after confirmation", async () => {
  vi.mocked(getCodexSource).mockResolvedValue(initial);
  vi.mocked(updateCodexSource).mockImplementation(async (body) => ({
    ...initial,
    revision: "updated",
    provider: "fpl_custom",
    managed: true,
    model: body.model,
    base_url: body.base_url,
    env_key: body.env_key,
    backup_available: true,
  }));
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CodexModelSourcePage onBack={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("gpt-existing")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "自定义 Responses API" }),
  );
  await user.type(screen.getByLabelText("模型 ID"), "local-model");
  await user.type(
    screen.getByLabelText("API 基础地址"),
    "http://127.0.0.1:1234/v1",
  );
  await user.type(screen.getByLabelText(/API Key 环境变量名/), "LOCAL_KEY");
  await user.click(screen.getByRole("button", { name: "应用到本机 Codex" }));
  expect(updateCodexSource).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认应用" }));
  await waitFor(() =>
    expect(updateCodexSource).toHaveBeenCalledWith({
      expected_revision: "initial",
      source: "custom",
      model: "local-model",
      base_url: "http://127.0.0.1:1234/v1",
      env_key: "LOCAL_KEY",
    }),
  );
  expect(await screen.findByText(/已更新本机 Codex 配置/)).toBeInTheDocument();
});
