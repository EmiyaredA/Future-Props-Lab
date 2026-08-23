import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { downloadLogReproduction, type CallLog } from "@features/models/api";
import { LogReproductionButton } from "@features/models/logs/LogReproductionButton";

vi.mock("@features/models/api", () => ({
  downloadLogReproduction: vi.fn(),
}));

const LOG: CallLog = {
  id: "log-reproduction-test",
  call_source: "model_playground",
  provider_kind: "openai",
  model: "gpt-test",
  trace_id: "trace-test",
  request_payload: {},
  response_payload: {},
  prompt_tokens: 1,
  completion_tokens: 1,
  total_tokens: 2,
  latency_ms: 120,
  status: "success",
  error_message: null,
  reproduction_supported: true,
  reproduction_reason: "",
  created_at: "2026-08-23T01:02:03Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

test("downloads a reproduction bundle without exposing credentials", async () => {
  const user = userEvent.setup();
  vi.mocked(downloadLogReproduction).mockResolvedValue(
    new Blob(["reproduction"], { type: "application/zip" }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:model-reproduction"),
  });
  const revoke = vi.fn();
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  const anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);

  render(<LogReproductionButton log={LOG} />);
  expect(screen.getByText(/不包含密钥/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "导出复现包" }));

  await waitFor(() =>
    expect(downloadLogReproduction).toHaveBeenCalledWith(
      "log-reproduction-test",
    ),
  );
  expect(anchorClick).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:model-reproduction");
});

test("explains why a log cannot be reproduced", () => {
  render(
    <LogReproductionButton
      log={{
        ...LOG,
        reproduction_supported: false,
        reproduction_reason: "日志只保存了附件元数据，没有原始附件内容。",
      }}
    />,
  );

  expect(screen.getByRole("button", { name: "导出复现包" })).toBeDisabled();
  expect(screen.getByText(/没有原始附件内容/)).toBeInTheDocument();
});
