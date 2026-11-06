import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { RunReview } from "@features/visual-workshop/acceptance/RunReview";
import { EvidenceViewer } from "@features/visual-workshop/acceptance/EvidenceViewer";
import { ReferenceMaterials } from "@features/visual-workshop/acceptance/ReferenceMaterials";
import { RecheckHistory } from "@features/visual-workshop/acceptance/RecheckHistory";
import { acceptanceRun } from "../helpers/acceptance";
import type { VisualCanvasNode } from "@features/visual-workshop/api";
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: (path?: string) => ({
    url: path ? `blob:${path}` : "",
    loading: false,
    error: null,
  }),
}));
const act = async <T,>(action: () => Promise<T>) => action();
const reviewProps = () => ({
  projectId: "project",
  run: acceptanceRun(),
  onUpdate: vi.fn(),
  onRepair: vi.fn(),
  onRecheck: vi.fn(),
  onAdopt: vi.fn(),
  onOpenRun: vi.fn(),
  onBack: vi.fn(),
  onViewStandard: vi.fn(),
  repairs: {},
  writable: true,
  busy: false,
  act,
});
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
});
test("review polling retains handwritten decisions and pending items block finalization", async () => {
  const user = userEvent.setup(),
    props = reviewProps();
  const view = render(<RunReview {...props} />, { wrapper });
  await user.type(screen.getByLabelText("判断说明"), "保持眼镜和发型一致");
  view.rerender(
    <RunReview
      {...props}
      run={{
        ...props.run,
        revision: 4,
        snapshot: { ...props.run.snapshot, coverage: "追加了 12 帧" },
      }}
    />,
  );
  expect(screen.getByLabelText("判断说明")).toHaveValue("保持眼镜和发型一致");
  expect(
    screen.getByRole("button", { name: "确认整体验收结论" }),
  ).toBeDisabled();
  expect(props.onAdopt).not.toHaveBeenCalled();
});
test("passed reviews expose separate adoption and readonly reviews disable mutations", () => {
  const props = reviewProps();
  props.run = {
    ...props.run,
    decision: "passed",
    results: props.run.results.map((item) => ({ ...item, verdict: "passed" })),
  };
  render(<RunReview {...props} writable={false} />, { wrapper });
  expect(screen.getByRole("button", { name: "设为最终输出" })).toBeDisabled();
  expect(props.onAdopt).not.toHaveBeenCalled();
});
test("reference selection replaces and removes fixed assets without invented versions", async () => {
  const user = userEvent.setup();
  const nodes = [
    {
      id: "n",
      title: "角色基准",
      kind: "image",
      asset_id: "new",
      position: { x: 0, y: 0 },
    },
  ] as VisualCanvasNode[];
  function References() {
    const [ids, setIds] = useState(["old"]);
    return (
      <ReferenceMaterials
        ids={ids}
        nodes={nodes}
        onChange={setIds}
        disabled={false}
      />
    );
  }
  render(<References />);
  expect(screen.getByText("固定素材")).toBeVisible();
  expect(screen.queryByText(/v1/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "替换参考 1" }));
  await user.click(screen.getByRole("button", { name: "绑定 角色基准" }));
  expect(screen.getByText("角色基准")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "解除参考 1" }));
  expect(screen.getByText(/尚未绑定参考/)).toBeVisible();
});
test("recheck issues need a matching criterion and manual confirmation before resolved", () => {
  const previous = acceptanceRun({
    id: "previous",
    results: [
      {
        criterion_id: "rule",
        verdict: "failed",
        origin: "ai",
        explanation: "握持穿插",
        evidence_ids: [],
      },
    ],
  });
  const run = acceptanceRun({
    results: [
      {
        criterion_id: "rule",
        verdict: "passed",
        origin: "automatic",
        explanation: "",
        evidence_ids: [],
      },
    ],
  });
  const view = render(
    <RecheckHistory run={run} previous={previous} onOpen={vi.fn()} />,
  );
  expect(screen.getByText("待复核")).toBeVisible();
  view.rerender(
    <RecheckHistory
      run={{
        ...run,
        decisions: [
          { criterion_id: "rule", verdict: "passed", reason: "已经核对" },
        ],
      }}
      previous={previous}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText("已解决")).toBeVisible();
  view.rerender(
    <RecheckHistory
      run={{ ...run, results: [] }}
      previous={previous}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText("未关联")).toBeVisible();
});
function loaded(video: HTMLVideoElement, duration: number) {
  Object.defineProperties(video, {
    duration: { configurable: true, value: duration },
    readyState: { configurable: true, value: 4 },
  });
  fireEvent.loadedMetadata(video);
}
test("custom playback clamps the shorter old video and evidence seek uses actual sample times", async () => {
  const user = userEvent.setup();
  const previous = acceptanceRun({
    id: "old",
    snapshot: {
      ...acceptanceRun().snapshot,
      output: {
        ...acceptanceRun().snapshot.output,
        asset_id: "oldasset",
        version: 1,
      },
    },
  });
  const run = acceptanceRun({
    evidence: [
      {
        id: "sample",
        asset_id: "frame",
        source_asset_id: "asset",
        position_ms: 1750,
      },
      {
        id: "ref",
        asset_id: "reference-frame",
        source_asset_id: "other",
        position_ms: 3000,
      },
    ],
  });
  render(<EvidenceViewer run={run} previous={previous} />);
  const current = screen.getByLabelText("验收视频") as HTMLVideoElement,
    old = screen.getByLabelText("返修前视频") as HTMLVideoElement;
  loaded(current, 8);
  loaded(old, 2);
  await user.click(screen.getByRole("button", { name: "播放视频" }));
  current.currentTime = 5;
  fireEvent.timeUpdate(current);
  expect(old.currentTime).toBe(2);
  expect(old.paused).toBe(true);
  await user.click(screen.getByRole("button", { name: "查看 1750 毫秒证据" }));
  expect(current.currentTime).toBe(1.75);
  expect(old.currentTime).toBe(1.75);
  expect(
    screen.queryByRole("button", { name: "查看 3000 毫秒证据" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("视频音量"), {
    target: { value: "0.4" },
  });
  expect(current.volume).toBe(0.4);
});
test("rejected play shows an error and never pretends the video is playing", async () => {
  const user = userEvent.setup();
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
    new Error("unsupported"),
  );
  render(<EvidenceViewer run={acceptanceRun()} />);
  loaded(screen.getByLabelText("验收视频") as HTMLVideoElement, 8);
  await user.click(screen.getByRole("button", { name: "播放视频" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("播放失败"),
  );
  expect(screen.getByRole("button", { name: "播放视频" })).toBeVisible();
});
