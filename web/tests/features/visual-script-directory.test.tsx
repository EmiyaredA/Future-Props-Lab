import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import ScriptWorkspace from "@features/visual-workshop/creative/ScriptWorkspace";
import {
  getScript,
  saveScript,
  scriptKey,
  type Script,
} from "@features/visual-workshop/creative/api";
import { visualWorkshopQueryKeys as keys } from "@features/visual-workshop/queryKeys";
import { emptyShot } from "@features/visual-workshop/storyboard/shotPlans";
import {
  getStoryboard,
  saveStoryboard,
  type Shot,
} from "@features/visual-workshop/storyboard/api";

vi.mock("@features/visual-workshop/storyboard/api", async (original) => ({
  ...(await original<
    typeof import("@features/visual-workshop/storyboard/api")
  >()),
  getStoryboard: vi.fn(),
  saveStoryboard: vi.fn(),
}));

vi.mock("@features/visual-workshop/creative/api", async (original) => ({
  ...(await original<
    typeof import("@features/visual-workshop/creative/api")
  >()),
  saveScript: vi.fn(),
  getScript: vi.fn(),
}));
const episodes: Script["episodes"] = [
  {
    id: "e1",
    title: "第一集",
    scenes: [
      { id: "s1", title: "意外来客", heading: "咖啡馆", text: "第一场正文" },
    ],
  },
  {
    id: "e2",
    title: "第二集",
    scenes: [
      { id: "s2", title: "雨夜重逢", heading: "街角", text: "第二场正文" },
    ],
  },
];
beforeEach(() => {
  vi.mocked(getScript).mockReset();
  vi.mocked(getStoryboard).mockResolvedValue({ revision: 0, shots: [] });
  vi.mocked(saveStoryboard)
    .mockReset()
    .mockImplementation(async (_, value) => ({
      ...value,
      revision: value.revision + 1,
    }));
  vi.mocked(saveScript)
    .mockReset()
    .mockImplementation(async (_, script) => ({
      ...script,
      revision: script.revision + 1,
    }));
});
function setup(
  readOnly = false,
  initialSceneId?: string,
  shots: Shot[] = [],
  scriptEpisodes = episodes,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(scriptKey("project"), {
    revision: 1,
    episodes: scriptEpisodes,
  });
  client.setQueryData(keys.storyboard("project"), { revision: 0, shots });
  const leave = vi.fn();
  const onStoryboard = vi.fn();
  const onPrepareShot = vi.fn(async (shot: Shot) => ({
    ...shot,
    video_node_id: shot.video_node_id ?? "shot-video",
  }));
  render(
    <QueryClientProvider client={client}>
      <ScriptWorkspace
        project="project"
        readOnly={readOnly}
        initialSceneId={initialSceneId}
        onStoryboard={onStoryboard}
        onPrepareShot={onPrepareShot}
        renderHeader={(_, navigate) => (
          <button onClick={() => navigate(leave)}>返回工作台</button>
        )}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), leave, onStoryboard, onPrepareShot };
}

test("creating a shot from a script selection keeps its video identity across failed storyboard saves", async () => {
  const { user, onPrepareShot, onStoryboard } = setup(false, "s1");
  const input = screen.getByRole("textbox", {
    name: "剧本文本",
  }) as HTMLTextAreaElement;
  await user.click(input);
  input.setSelectionRange(0, input.value.length);
  fireEvent.keyUp(input, { key: "a", ctrlKey: true });
  vi.mocked(saveStoryboard).mockRejectedValueOnce(new Error("暂时无法保存"));
  await user.click(screen.getByRole("button", { name: "从选段新建镜头" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法保存");
  expect(onStoryboard).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "从选段新建镜头" }));
  await waitFor(() => expect(onStoryboard).toHaveBeenCalledOnce());
  const calls = vi.mocked(saveStoryboard).mock.calls;
  expect(calls[0][1].shots[0]).toMatchObject({
    video_node_id: "shot-video",
    description: "第一场正文",
  });
  expect(calls[1][1].shots[0].id).toBe(calls[0][1].shots[0].id);
  expect(onPrepareShot.mock.calls[1][0].video_node_id).toBe("shot-video");
});

test("linked shot rows show the current scene's excerpt and open that shot", async () => {
  const shot = {
    ...emptyShot("人物近景"),
    source: { scene_id: "s1", revision: 1, excerpt: "第一场正文" },
  };
  const { user, onStoryboard } = setup(false, "s1", [
    shot,
    {
      ...emptyShot("另一场镜头"),
      source: { scene_id: "s2", revision: 1, excerpt: "" },
    },
  ]);
  await user.click(screen.getByRole("button", { name: "关联分镜 1" }));
  const panel = screen.getByRole("complementary", { name: "剧本关联镜头" });
  expect(within(panel).getByText("第一场正文")).toBeVisible();
  expect(within(panel).queryByText("另一场镜头")).not.toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: "人物近景" }));
  await waitFor(() => expect(onStoryboard).toHaveBeenCalledWith(shot.id));
});

test("a project without a script does not list unassigned shots as related scenes", async () => {
  const { user } = setup(false, undefined, [emptyShot("无来源镜头")], []);
  await user.click(screen.getByRole("button", { name: "关联分镜 0" }));
  const panel = screen.getByRole("complementary", { name: "剧本关联镜头" });
  expect(within(panel).queryByText("无来源镜头")).not.toBeInTheDocument();
  expect(within(panel).getByText("选择场次后查看关联分镜")).toBeVisible();
  expect(
    within(panel).getByRole("button", { name: "从选段新建镜头" }),
  ).toBeDisabled();
});

test("episodes expand independently; collapsing the active episode keeps its editor and search restores expansion", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "展开第二集" }));
  expect(screen.getByRole("button", { name: "意外来客" })).toBeVisible();
  expect(screen.getByRole("button", { name: "雨夜重逢" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "雨夜重逢" }));
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第二场正文");
  await user.click(screen.getByRole("button", { name: "收起第二集" }));
  expect(screen.queryByRole("button", { name: "雨夜重逢" })).toBeNull();
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第二场正文");
  await user.type(
    screen.getByRole("textbox", { name: "搜索集与场次" }),
    "雨夜",
  );
  expect(screen.getByRole("button", { name: "雨夜重逢" })).toBeVisible();
  await user.clear(screen.getByRole("textbox", { name: "搜索集与场次" }));
  expect(screen.queryByRole("button", { name: "雨夜重逢" })).toBeNull();
  expect(screen.getByRole("button", { name: "意外来客" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "全部收起" }));
  expect(screen.queryByRole("button", { name: "意外来客" })).toBeNull();
  expect(saveScript).not.toHaveBeenCalled();
});

test("adding a scene to a nonactive expanded episode updates that episode and preserves unsaved text", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText("剧本文本"), "，尚未保存");
  await user.click(screen.getByRole("button", { name: "展开第二集" }));
  const owner = screen
    .getByRole("button", {
      name: "收起第二集",
    })
    .closest<HTMLElement>(".script-tree-episode")!;
  await user.click(within(owner).getByRole("button", { name: "新建场" }));
  expect(screen.getByLabelText("场次名称")).toHaveValue("第 2 场");
  expect(screen.getByLabelText("场景信息")).toHaveValue("室内 · 咖啡馆 · 夜");
  expect(
    (screen.getByLabelText("剧本文本") as HTMLTextAreaElement).value,
  ).toContain("林舟：");
  expect(screen.getByRole("button", { name: "提取设定" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  await waitFor(() => expect(saveScript).toHaveBeenCalledOnce());
  const saved = vi.mocked(saveScript).mock.calls[0][1];
  expect(saved.episodes[0].scenes).toHaveLength(1);
  expect(saved.episodes[0].scenes[0].text).toBe("第一场正文，尚未保存");
  expect(saved.episodes[1].scenes).toHaveLength(2);
  expect(saved.episodes[1].scenes[1].text).toContain("苏晚：");
});

test("new scene examples are editable drafts and clearing them is preserved after failed save and retry", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "新建集" }));
  const owner = screen
    .getByRole("button", { name: "收起第 3 集" })
    .closest<HTMLElement>(".script-tree-episode")!;
  await user.click(within(owner).getByRole("button", { name: "新建场" }));
  expect(saveScript).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText("剧本文本") as HTMLTextAreaElement).value,
  ).toContain("信封");
  await user.clear(screen.getByLabelText("剧本文本"));
  await user.clear(screen.getByLabelText("场景信息"));
  vi.mocked(saveScript).mockRejectedValueOnce(new Error("保存失败"));
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(screen.getByLabelText("剧本文本")).toHaveValue("");
  expect(screen.getByLabelText("场景信息")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  await waitFor(() => expect(saveScript).toHaveBeenCalledTimes(2));
  expect(
    vi.mocked(saveScript).mock.calls[1][1].episodes[2].scenes[0],
  ).toMatchObject({ heading: "", text: "" });
  await user.click(screen.getByRole("button", { name: "意外来客" }));
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第一场正文");
});

test("failed save blocks leaving and retains the active draft and expanded episodes", async () => {
  const { user, leave } = setup();
  await user.click(screen.getByRole("button", { name: "展开第二集" }));
  await user.type(screen.getByLabelText("剧本文本"), "修改");
  vi.mocked(saveScript).mockRejectedValueOnce(new Error("保存失败"));
  await user.click(screen.getByRole("button", { name: "返回工作台" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(leave).not.toHaveBeenCalled();
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第一场正文修改");
  expect(screen.getByRole("button", { name: "雨夜重逢" })).toBeVisible();
});

test("read-only scripts retain navigation and expansion but do not expose creation or saving", async () => {
  const { user } = setup(true);
  await user.click(screen.getByRole("button", { name: "展开第二集" }));
  await user.click(screen.getByRole("button", { name: "雨夜重逢" }));
  expect(screen.getByText("第二场正文")).toBeVisible();
  expect(screen.queryByRole("button", { name: "新建场" })).toBeNull();
  expect(screen.queryByRole("button", { name: "保存剧本" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^删除/ })).toBeNull();
});

test("an empty episode can be selected without coupling its expansion to the editor", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "新建集" }));
  await user.click(screen.getByRole("button", { name: "意外来客" }));
  await user.click(screen.getByRole("button", { name: "编辑第 3 集" }));
  expect(screen.getByLabelText("分集名称")).toHaveValue("第 3 集");
  expect(screen.getByText("本集还没有场次。")).toBeVisible();
  expect(saveScript).not.toHaveBeenCalled();
});

test("source navigation reveals and scrolls to the target scene without reopening it on later edits", async () => {
  const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
  const { user } = setup(false, "s2");
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第二场正文");
  await waitFor(() =>
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" }),
  );
  await user.click(screen.getByRole("button", { name: "收起第二集" }));
  await user.type(screen.getByLabelText("剧本文本"), "修改");
  expect(screen.queryByRole("button", { name: "雨夜重逢" })).toBeNull();
  scroll.mockRestore();
});

test("deletion confirmation can be cancelled without changing the active draft", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText("剧本文本"), "，未保存");
  const remove = screen.getByRole("button", { name: "删除场次 意外来客" });
  await user.click(remove);
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveAccessibleName("删除场次“意外来客”？");
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(remove).toHaveFocus();
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第一场正文，未保存");
  expect(saveScript).not.toHaveBeenCalled();
  await user.click(remove);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("deleting an active scene selects its neighbour and failed saving retains deletion and other edits", async () => {
  const { user } = setup(
    false,
    "s1",
    [],
    [
      {
        ...episodes[0],
        scenes: [
          episodes[0].scenes[0],
          { id: "s3", title: "离开咖啡馆", heading: "", text: "第三场正文" },
        ],
      },
      episodes[1],
    ],
  );
  await user.click(screen.getByRole("button", { name: "离开咖啡馆" }));
  await user.type(screen.getByLabelText("剧本文本"), "，未保存");
  await user.click(screen.getByRole("button", { name: "意外来客" }));
  await user.click(screen.getByRole("button", { name: "删除场次 意外来客" }));
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: /^删除$/,
    }),
  );
  expect(screen.getByLabelText("场次名称")).toHaveValue("离开咖啡馆");
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第三场正文，未保存");
  expect(screen.queryByRole("button", { name: "意外来客" })).toBeNull();
  expect(saveScript).not.toHaveBeenCalled();
  vi.mocked(saveScript).mockRejectedValueOnce(new Error("保存失败"));
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第三场正文，未保存");
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  await waitFor(() => expect(saveScript).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveScript).mock.calls[1][1].episodes[0].scenes).toEqual([
    { id: "s3", title: "离开咖啡馆", heading: "", text: "第三场正文，未保存" },
  ]);
});

test("deleting the last scene keeps its empty episode and linked shots", async () => {
  const shot = {
    ...emptyShot("保留镜头"),
    source: { scene_id: "s1", revision: 1, excerpt: "第一场正文" },
  };
  const { user } = setup(false, "s1", [shot]);
  await user.click(screen.getByRole("button", { name: "删除场次 意外来客" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "已关联的分镜和素材会保留",
  );
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: /^删除$/,
    }),
  );
  expect(screen.getByLabelText("分集名称")).toHaveValue("第一集");
  expect(screen.getByText("本集还没有场次。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  await waitFor(() => expect(saveScript).toHaveBeenCalledOnce());
  expect(vi.mocked(saveScript).mock.calls[0][1].episodes[0].scenes).toEqual([]);
  expect(saveStoryboard).not.toHaveBeenCalled();
});

test("deleting a filtered inactive episode removes all its scenes and preserves active edits", async () => {
  const { user } = setup(
    false,
    undefined,
    [],
    [
      episodes[0],
      {
        ...episodes[1],
        scenes: [
          ...episodes[1].scenes,
          { id: "s3", title: "隐藏场次", heading: "", text: "正文" },
        ],
      },
    ],
  );
  await user.type(screen.getByLabelText("剧本文本"), "，未保存");
  await user.type(
    screen.getByRole("textbox", { name: "搜索集与场次" }),
    "雨夜",
  );
  await user.click(screen.getByRole("button", { name: "删除整集 第二集" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("全部 2 个场次");
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: /^删除$/,
    }),
  );
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第一场正文，未保存");
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  await waitFor(() => expect(saveScript).toHaveBeenCalledOnce());
  expect(vi.mocked(saveScript).mock.calls[0][1].episodes).toHaveLength(1);
});

test("deleting active episodes selects the next episode and supports removing the whole script", async () => {
  const { user } = setup();
  for (const title of ["第一集", "第二集"]) {
    await user.click(screen.getByRole("button", { name: `删除整集 ${title}` }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: /^删除$/,
      }),
    );
    if (title === "第一集") {
      expect(screen.getByLabelText("场次名称")).toHaveValue("雨夜重逢");
    }
  }
  expect(screen.getByText("这个项目还没有剧本。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  await waitFor(() => expect(saveScript).toHaveBeenCalledOnce());
  expect(vi.mocked(saveScript).mock.calls[0][1].episodes).toEqual([]);
  await user.click(screen.getByRole("button", { name: "新建集" }));
  expect(screen.getByLabelText("分集名称")).toHaveValue("第 1 集");
});

test("reloading after a failed save uses the project confirmation and can be cancelled", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText("剧本文本"), "，未保存");
  vi.mocked(saveScript).mockRejectedValueOnce(new Error("保存失败"));
  await user.click(screen.getByRole("button", { name: "保存剧本" }));
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "载入服务器版本" }));
  const dialog = screen.getByRole("alertdialog", { name: "载入服务器版本？" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(getScript).not.toHaveBeenCalled();
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第一场正文，未保存");
  vi.mocked(getScript).mockResolvedValue({ revision: 2, episodes });
  await user.click(screen.getByRole("button", { name: "载入服务器版本" }));
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "载入",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByLabelText("剧本文本")).toHaveValue("第一场正文");
  expect(screen.getByRole("button", { name: "保存剧本" })).toBeDisabled();
});
