import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { CreativeWorkshopPage } from "@features/creative-workshop/CreativeWorkshopPage";
import type { CreativeItem } from "@features/creative-workshop/api";

const mocks = vi.hoisted(() => ({
  listCreative: vi.fn(),
  getCreative: vi.fn(),
  createCreative: vi.fn(),
  updateCreative: vi.fn(),
  publishCreative: vi.fn(),
}));

vi.mock("@features/creative-workshop/api", () => ({
  ...mocks,
  getCreativeRelease: vi.fn(),
  importCreative: vi.fn(),
  installCreative: vi.fn(),
  previewInstall: vi.fn(),
  uploadCreative: vi.fn(),
  withdrawCreative: vi.fn(),
  configureStdio: vi.fn(),
}));

const item: CreativeItem = {
  id: "weather",
  kind: "tool_api",
  status: "published",
  title: "天气接口",
  summary: "查询天气预报",
  description: "安装后配置密钥",
  tags: ["天气"],
  cover_preset: "sunrise",
  cover_url: null,
  manifest: {
    method: "GET",
    url: "https://example.com/weather",
    auth_kind: "none",
  },
  components: [],
  revision: 2,
  author_user_id: "u1",
  author_name: "阿星",
  origin_workspace_id: "a",
  current_release_id: "r1",
  version: 1,
  installable: true,
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCreative.mockResolvedValue({ items: [item], next_cursor: null });
  mocks.getCreative.mockResolvedValue(item);
  mocks.createCreative.mockResolvedValue({
    ...item,
    status: "draft",
    current_release_id: null,
  });
  mocks.updateCreative.mockResolvedValue({
    ...item,
    status: "draft",
    revision: 3,
  });
  mocks.publishCreative.mockResolvedValue({ ...item, revision: 4, version: 2 });
});

test("public square searches and opens a published item", async () => {
  const navigate = vi.fn();
  render(
    <CreativeWorkshopPage
      mode="creative-workshop"
      canWrite={false}
      canInstall={false}
      navigate={navigate}
    />,
  );
  expect(await screen.findByText("天气接口")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "＋ 发布创作" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索创作" }), {
    target: { value: "天气" },
  });
  await waitFor(() =>
    expect(mocks.listCreative).toHaveBeenLastCalledWith({
      mine: false,
      kind: "all",
      q: "天气",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /天气接口/ }));
  expect(navigate).toHaveBeenCalledWith("creative-workshop-detail", "weather");
});

test("editor saves a draft before preview and publishes the next version", async () => {
  const navigate = vi.fn();
  render(
    <CreativeWorkshopPage
      mode="creative-workshop-editor"
      itemId="weather"
      canWrite
      canInstall
      navigate={navigate}
    />,
  );
  expect(await screen.findByDisplayValue("天气接口")).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue("天气接口"), {
    target: { value: "天气接口 2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览与发布 →" }));
  await screen.findByRole("button", { name: "确认公开发布" });
  expect(mocks.updateCreative).toHaveBeenCalledWith(
    "weather",
    expect.objectContaining({ title: "天气接口 2" }),
    2,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认公开发布" }));
  expect(await screen.findByText("发布成功")).toBeInTheDocument();
  expect(mocks.publishCreative).toHaveBeenCalledWith("weather", 3);
});
