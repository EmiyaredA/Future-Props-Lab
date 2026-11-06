import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectPicker } from "@features/agent-workbench/ProjectPicker";

it("opens from its own trigger and restores focus on Escape", async () => {
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectPicker
        owner="admin"
        catalog={{
          enabled: true,
          can_select_directory: true,
          projects: [{ id: "remote", label: "配置项目" }],
          agents: [],
        }}
        disabled={false}
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: "选择项目" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "选择项目" });
  expect(dialog).toHaveClass("workbench-project-dialog");
  expect(dialog).not.toHaveClass("cloud-dialog");
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "配置项目" }));
  expect(onSelect).toHaveBeenCalledWith({ id: "remote", label: "配置项目" });
});
