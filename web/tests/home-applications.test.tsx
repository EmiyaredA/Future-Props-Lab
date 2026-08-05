import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ApplicationCenterPage } from "@features/applications/ApplicationCenterPage";
import { HomePage } from "@features/home/HomePage";

test("home keeps the three destinations equal and links model shortcuts", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<HomePage onNavigate={navigate} />);
  expect(
    screen.getByRole("heading", { name: "今天想从哪里开始？" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /AI应用/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /工具导航/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /基模型/ })).toBeInTheDocument();
  expect(screen.queryByText("视觉创作工坊")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /浏览应用/ }));
  expect(navigate).toHaveBeenCalledWith("/apps");
  await user.click(screen.getByRole("button", { name: /模型测试/ }));
  expect(navigate).toHaveBeenCalledWith("/model-test");
});

test("application center filters and records recent application access", async () => {
  const user = userEvent.setup();
  const open = vi.fn();
  const { container } = render(<ApplicationCenterPage onOpen={open} />);
  expect(screen.getByText("还没有访问记录")).toBeInTheDocument();
  expect(container.querySelector(".application-icon img")).toHaveAttribute(
    "src",
    "/brand/visual-workshop-mark.png",
  );
  expect(
    container.querySelectorAll(".application-icon img")[1],
  ).toHaveAttribute("src", "/brand/galgame-workshop-mark.png");
  expect(screen.queryByText("AI 应用")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "效率协作" }));
  expect(screen.getByText("没有找到匹配的应用")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "全部应用" }));
  await user.type(screen.getByRole("textbox", { name: "搜索AI应用" }), "视频");
  await user.click(screen.getByRole("button", { name: "打开视觉创作工坊" }));
  expect(open).toHaveBeenCalledWith("/apps/visual-workshop");
  expect(localStorage.getItem("future-props-recent-applications")).toContain(
    "visual-workshop",
  );
  expect(screen.getAllByText("视觉创作工坊")).toHaveLength(2);
});
