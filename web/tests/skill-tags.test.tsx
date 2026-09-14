import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SkillPanel } from "@features/integrations/SkillPanel";
import {
  createSkill,
  getSkills,
  updateSkill,
  type Skill,
} from "@features/integrations/api";
import { ApiError } from "@platform/api/client";

vi.mock("@features/integrations/api", async () => ({
  ...(await vi.importActual<typeof import("@features/integrations/api")>(
    "@features/integrations/api",
  )),
  getSkills: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
}));

const base: Skill = {
  id: "h3",
  name: "h3-prompt-writing",
  description: "Prompt writing",
  tags: ["MiniMax H3", "提示词"],
  default_version: "v1",
  latest_version: "v1",
  version_count: 1,
  enabled: true,
  status: "healthy",
  status_message: "",
  revision: 3,
  created_at: "2026-09-09",
  updated_at: "2026-09-09",
};
let items: Skill[];
function Panel({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  return (
    <SkillPanel
      canManage={canManage}
      search={search}
      status={status}
      onSearchChange={setSearch}
      onStatusChange={setStatus}
    />
  );
}
function setup(canManage = true) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <Panel canManage={canManage} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
beforeEach(() => {
  vi.clearAllMocks();
  items = [
    base,
    { ...base, id: "plain", name: "plain-skill", tags: [], enabled: false },
  ];
  vi.mocked(getSkills).mockImplementation(async () => ({
    items,
    enabled_count: 1,
    draft_count: 1,
    version_count: 2,
  }));
  vi.mocked(updateSkill).mockImplementation(
    async (skill, enabled, version, tags) => {
      const changed = {
        ...skill,
        enabled,
        default_version: version,
        tags: tags ?? skill.tags,
        revision: skill.revision + 1,
      };
      items = items.map((item) => (item.id === skill.id ? changed : item));
      return changed;
    },
  );
  vi.mocked(createSkill).mockResolvedValue(base);
});

test("edits normalized tags, clears them and preserves version settings", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "编辑 h3-prompt-writing 标签" }),
  );
  let dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByRole("textbox"));
  await user.type(
    within(dialog).getByRole("textbox"),
    " MiniMax H3，广告, 广告,,",
  );
  await user.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await waitFor(() =>
    expect(updateSkill).toHaveBeenCalledWith(base, true, "v1", [
      "MiniMax H3",
      "广告",
    ]),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    within(screen.getByLabelText("h3-prompt-writing 标签")).getByText("广告"),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "编辑 h3-prompt-writing 标签" }),
  );
  dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByRole("textbox"));
  await user.click(within(dialog).getByRole("button", { name: "保存标签" }));
  await waitFor(() =>
    expect(updateSkill).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 4 }),
      true,
      "v1",
      [],
    ),
  );
});

test("combines text, status and tag filters including untagged and no results", async () => {
  const user = setup();
  await screen.findByRole("heading", { name: "plain-skill" });
  await user.click(screen.getByRole("combobox", { name: "Skill 标签筛选" }));
  await user.click(screen.getByRole("option", { name: "MiniMax H3" }));
  expect(screen.queryByRole("heading", { name: "plain-skill" })).toBeNull();
  await user.type(
    screen.getByRole("textbox", { name: "搜索 Skill" }),
    "提示词",
  );
  expect(
    screen.getByRole("heading", { name: "h3-prompt-writing" }),
  ).toBeVisible();
  await user.click(screen.getByRole("combobox", { name: "Skill 状态筛选" }));
  await user.click(screen.getByRole("option", { name: "草稿" }));
  expect(screen.getByText("没有匹配的 Skill。")).toBeVisible();
  await user.clear(screen.getByRole("textbox", { name: "搜索 Skill" }));
  await user.click(screen.getByRole("combobox", { name: "Skill 标签筛选" }));
  await user.click(screen.getByRole("option", { name: "无标签" }));
  expect(screen.getByRole("heading", { name: "plain-skill" })).toBeVisible();
});

test("uploads with tags and blocks more than twelve tags", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "上传 Skill" }));
  const dialog = screen.getByRole("dialog");
  const file = new File(["test zip"], "skill.zip", { type: "application/zip" });
  await user.upload(
    dialog.querySelector("input[type=file]") as HTMLInputElement,
    file,
  );
  const input = within(dialog).getByRole("textbox");
  await user.type(
    input,
    Array.from({ length: 13 }, (_, i) => `tag${i}`).join(","),
  );
  expect(
    within(dialog).getByRole("button", { name: "上传并校验" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "最多添加 12 个标签",
  );
  await user.clear(input);
  await user.type(input, "MiniMax H3，视频生成");
  await user.click(within(dialog).getByRole("switch", { name: "导入后启用" }));
  await user.click(within(dialog).getByRole("button", { name: "上传并校验" }));
  await waitFor(() =>
    expect(createSkill).toHaveBeenCalledWith(file, true, [
      "MiniMax H3",
      "视频生成",
    ]),
  );
});

test("read-only viewers can filter but cannot upload or edit tags", async () => {
  setup(false);
  await screen.findByRole("heading", { name: "h3-prompt-writing" });
  expect(
    screen.getByRole("combobox", { name: "Skill 标签筛选" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: /编辑 .* 标签/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "上传 Skill" })).toBeNull();
});

test("refreshes on revision conflict and never retries an overwrite", async () => {
  vi.mocked(updateSkill).mockRejectedValue(
    new ApiError(
      "Conflict",
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "revision_conflict",
        detail: "Conflict",
      },
      409,
    ),
  );
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "编辑 h3-prompt-writing 标签" }),
  );
  await user.click(screen.getByRole("button", { name: "保存标签" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  await waitFor(() => expect(getSkills).toHaveBeenCalledTimes(2));
  expect(updateSkill).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeVisible();
});

test("tag dialog closes with Escape and restores focus", async () => {
  const user = setup();
  const trigger = await screen.findByRole("button", {
    name: "编辑 h3-prompt-writing 标签",
  });
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});

for (const canManage of [true, false]) {
  test(`shows complete Skill details and restores keyboard focus (manage=${canManage})`, async () => {
    const skill = {
      ...base,
      name: "very-long-skill-name-".repeat(5),
      description: "完整说明，包含所有制作步骤。".repeat(100),
      tags: ["MiniMax H3", "视频生成", "纸艺风格", "科普"],
    };
    items = [skill];
    const user = setup(canManage);
    const trigger = await screen.findByRole("button", {
      name: `查看 ${skill.name} 详情`,
    });
    const tags = within(screen.getByLabelText(`${skill.name} 标签`));
    expect(tags.getByText("MiniMax H3")).toBeVisible();
    expect(tags.getByText("视频生成")).toBeVisible();
    expect(tags.getByLabelText("另有 2 个标签")).toHaveTextContent("+2");
    expect(tags.queryByText("纸艺风格")).toBeNull();

    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = within(screen.getByRole("dialog", { name: "Skill 详情" }));
    expect(dialog.getByRole("heading", { name: skill.name })).toBeVisible();
    expect(dialog.getByText(skill.description)).toBeVisible();
    for (const tag of skill.tags) {
      expect(
        within(dialog.getByLabelText("全部标签")).getByText(tag),
      ).toBeVisible();
    }
    const close = dialog.getByRole("button", { name: "关闭" });
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(updateSkill).not.toHaveBeenCalled();
  });
}

test("shows empty Skill description and tags in details", async () => {
  items = [{ ...base, description: "", tags: [] }];
  const user = setup(false);
  await user.click(
    await screen.findByRole("button", { name: `查看 ${base.name} 详情` }),
  );
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText("暂无说明")).toBeVisible();
  expect(dialog.getByText("无标签")).toBeVisible();
  await user.click(dialog.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
