import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { APPLICATION_DEFINITIONS } from "@features/applications/definitions";
import type { ServicesStatus } from "@features/applications/serviceStatus";

const applications = APPLICATION_DEFINITIONS.slice(0, 2);
const checked = "2026-11-03T01:00:00Z";
function snapshot(
  phase: ServicesStatus["services"][number]["phase"],
): ServicesStatus {
  return {
    mode: "independent",
    checked_at: checked,
    services: [
      {
        service_id: "thought",
        label: "思绪工坊",
        phase,
        detail:
          phase === "running" ? "服务已就绪" : "服务已停止，请等待管理员启动",
        checked_at: checked,
        dependencies: [],
      },
    ],
  };
}

test("shows real readiness and reveals details without nesting controls", async () => {
  const user = userEvent.setup();
  const opened = vi.fn();
  render(
    <ApplicationCenterPage
      applications={applications}
      onOpen={opened}
      services={snapshot("running")}
    />,
  );
  const status = screen.getByRole("button", {
    name: "查看思绪工坊服务状态：运行中",
  });
  expect(status.parentElement!.closest("button")).toBeNull();
  await user.click(status);
  const details = screen.getByRole("region", { name: "思绪工坊服务状态" });
  expect(within(details).getByText("服务已就绪")).toBeInTheDocument();
  expect(status).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("button", { name: "打开思绪工坊" }));
  expect(opened).toHaveBeenCalledWith("/apps/thought-workshop");
});

test("shows stopped and dependency failures as separate explanations", async () => {
  const user = userEvent.setup();
  const value = snapshot("degraded");
  value.services[0]!.detail = "应用已运行，部分依赖服务尚未就绪";
  value.services[0]!.dependencies = [
    { service_id: "models", label: "模型服务", phase: "stopped" },
  ];
  const { rerender } = render(
    <ApplicationCenterPage
      applications={applications}
      onOpen={vi.fn()}
      services={snapshot("stopped")}
    />,
  );
  expect(
    screen.getByRole("button", { name: "查看思绪工坊服务状态：已停止" }),
  ).toBeInTheDocument();
  expect(screen.getByText("服务已停止，请等待管理员启动")).toBeInTheDocument();
  rerender(
    <ApplicationCenterPage
      applications={applications}
      onOpen={vi.fn()}
      services={value}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "查看思绪工坊服务状态：功能受限" }),
  );
  expect(screen.getByText("模型服务：已停止")).toBeInTheDocument();
});

test("a failed refresh never presents cached running status as current", async () => {
  const user = userEvent.setup();
  render(
    <ApplicationCenterPage
      applications={applications}
      onOpen={vi.fn()}
      services={snapshot("running")}
      unavailable
    />,
  );
  expect(
    screen.queryByRole("button", { name: "查看思绪工坊服务状态：运行中" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: "查看思绪工坊服务状态：状态暂不可读",
    }),
  );
  const region = screen.getByRole("region", { name: "思绪工坊服务状态" });
  expect(within(region).getByText("上次结果：运行中")).toBeInTheDocument();
  expect(within(region).getByText(/无法读取最新服务状态/)).toBeInTheDocument();
});

test("initial loading and explicit refresh have no invented healthy state", async () => {
  const user = userEvent.setup();
  const refresh = vi.fn();
  const { rerender } = render(
    <ApplicationCenterPage
      applications={applications}
      onOpen={vi.fn()}
      checking
      onRefresh={refresh}
    />,
  );
  expect(
    screen.getByRole("button", { name: "查看思绪工坊服务状态：检查中…" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "刷新状态" })).toBeDisabled();
  rerender(
    <ApplicationCenterPage
      applications={applications}
      onOpen={vi.fn()}
      services={snapshot("running")}
      onRefresh={refresh}
    />,
  );
  await user.click(screen.getByRole("button", { name: "刷新状态" }));
  expect(refresh).toHaveBeenCalledOnce();
});
