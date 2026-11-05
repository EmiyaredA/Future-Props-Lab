import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { vi } from "vitest";
import { CreativeWorkshopPage } from "@features/creative-workshop/CreativeWorkshopPage";
import type { CreativeItem } from "@features/creative-workshop/api";
import { NavigationProtection } from "@shared/ui/NavigationProtection";
import { guardedNavigation } from "@app/entries/navigation";
import type { Guard } from "@shared/ui/navigationGuards";

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
  origin_owner_user_id: "a",
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
  expect(screen.getAllByText("创意广场")).toHaveLength(1);
  expect(
    screen.queryByRole("heading", { name: "创意广场" }),
  ).not.toBeInTheDocument();
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
    <NavigationProtection>
      <CreativeWorkshopPage
        mode="creative-workshop-editor"
        itemId="weather"
        canWrite
        canInstall
        navigate={(...args) => guardedNavigation(() => navigate(...args))}
      />
    </NavigationProtection>,
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
  fireEvent.click(screen.getByRole("button", { name: "查看作品" }));
  expect(navigate).toHaveBeenCalledWith("creative-workshop-detail", "weather");
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("saving a draft preserves edits entered before the response arrives", async () => {
  let completeSave!: (value: CreativeItem) => void;
  mocks.updateCreative.mockImplementationOnce(
    () => new Promise<CreativeItem>((resolve) => (completeSave = resolve)),
  );
  render(
    <CreativeWorkshopPage
      mode="creative-workshop-editor"
      itemId="weather"
      canWrite
      canInstall
      navigate={vi.fn()}
    />,
  );
  const title = await screen.findByDisplayValue("天气接口");
  fireEvent.change(title, { target: { value: "即将保存" } });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  fireEvent.change(title, { target: { value: "保存期间继续输入" } });
  await act(async () =>
    completeSave({ ...item, title: "即将保存", revision: 3 }),
  );
  expect(title).toHaveValue("保存期间继续输入");
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
});

test("Creative editor uses keyboard accessible choices and protects unsaved changes", async () => {
  const leave = vi.fn();
  render(
    <NavigationProtection>
      <CreativeWorkshopPage
        mode="creative-workshop-editor"
        itemId="weather"
        canWrite
        canInstall
        navigate={() => guardedNavigation(leave)}
      />
    </NavigationProtection>,
  );
  await screen.findByDisplayValue("天气接口");
  const method = screen.getByRole("combobox", { name: "方法" });
  fireEvent.keyDown(method, { key: "ArrowDown" });
  const list = await screen.findByRole("listbox", { name: "方法" });
  fireEvent.keyDown(list, { key: "ArrowDown" });
  fireEvent.keyDown(list, { key: "Enter" });
  expect(method).toHaveTextContent("POST");
  fireEvent.click(screen.getByRole("button", { name: /^我的创作$/ }));
  expect(
    await screen.findByRole("alertdialog", { name: "草稿尚未保存" }),
  ).toBeVisible();
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "留在此页" }));
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^我的创作$/ }));
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  expect(leave).toHaveBeenCalledTimes(1);
});

test("recovery website also protects Creative drafts via its existing navigation guard", async () => {
  let guard: Guard | null = null;
  const register = (next: Guard | null) => {
    guard = next;
  };
  const leave = vi.fn();
  const view = render(
    <CreativeWorkshopPage
      mode="creative-workshop-editor"
      itemId="weather"
      canWrite
      canInstall
      navigate={vi.fn()}
      registerNavigationGuard={register}
    />,
  );
  fireEvent.change(await screen.findByDisplayValue("天气接口"), {
    target: { value: "未保存" },
  });
  expect(guard).not.toBeNull();
  act(() => {
    expect(guard!(leave)).toBe(true);
  });
  expect(
    await screen.findByRole("alertdialog", { name: "草稿尚未保存" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  expect(leave).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(guard).toBeNull();
});

test("independent context takes precedence over a legacy guard callback", async () => {
  const legacyRegister = vi.fn();
  const leave = vi.fn();
  render(
    <NavigationProtection>
      <CreativeWorkshopPage
        mode="creative-workshop-editor"
        itemId="weather"
        canWrite
        canInstall
        registerNavigationGuard={legacyRegister}
        navigate={() => guardedNavigation(leave)}
      />
    </NavigationProtection>,
  );
  fireEvent.change(await screen.findByDisplayValue("天气接口"), {
    target: { value: "未保存" },
  });
  expect(legacyRegister).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^我的创作$/ }));
  expect(
    await screen.findAllByRole("alertdialog", { name: "草稿尚未保存" }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "放弃填写并继续" }));
  expect(leave).toHaveBeenCalledTimes(1);
});
