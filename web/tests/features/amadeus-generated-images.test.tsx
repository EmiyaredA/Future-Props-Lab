import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "@features/amadeus/ActivityFeed";
import { ComposerModels } from "@features/amadeus/ComposerModels";
import { buildDisplayTimeline } from "@features/amadeus/displayTimeline";
import type { Detail, RunDetail } from "@features/amadeus/protocol";

vi.mock("@platform/api/useVisibleApiBlobUrl", () => ({
  useVisibleApiBlobUrl: () => ({
    ref: { current: null },
    url: "blob:owned-image",
    error: null,
  }),
}));

const at = "2026-11-20T02:00:00Z";
const image = {
  kind: "outputs" as const,
  name: "codex-123-abc.png",
  bytes: 72,
  sha256: "a".repeat(64),
  mime_type: "image/png" as const,
  width: 30,
  height: 20,
};
const detail: Detail = {
  conversation: {
    id: "chat",
    title: "生图",
    model_id: null,
    revision: 1,
    created_at: at,
    updated_at: at,
  },
  messages: [
    {
      id: "reply",
      run_id: "run",
      role: "assistant",
      content: "之前之后",
      created_at: at,
      references: [
        {
          id: `file:outputs:${image.name}`,
          application: "amadeus",
          name: image.name,
          source: "outputs",
          value: image.name,
        },
      ],
    },
  ],
  actions: [],
};
function record(status = "completed"): RunDetail {
  return {
    run: {
      id: "run",
      conversation_id: "chat",
      model_id: "",
      status,
      partial_text: "之前之后",
      created_at: at,
    },
    events: [
      {
        sequence: 1,
        kind: "assistant_delta",
        payload: { text: "之前" },
        created_at: at,
      },
      {
        sequence: 2,
        kind: "image_generation",
        payload: { item_id: "image", status: "started" },
        created_at: at,
      },
      {
        sequence: 3,
        kind: "image_generation",
        payload: { item_id: "image", status: "completed", image },
        created_at: at,
      },
      {
        sequence: 4,
        kind: "assistant_delta",
        payload: { text: "之后" },
        created_at: at,
      },
    ],
  };
}

describe("Amadeus generated images", () => {
  it("keeps one image between text chunks after history restoration", () => {
    const runs = [record()];
    const entries = buildDisplayTimeline(detail, runs).entries;
    expect(entries.map((entry) => entry.kind)).toEqual([
      "message",
      "image_generation",
      "message",
      "run_summary",
    ]);
    render(
      <ActivityFeed
        detail={detail}
        runs={runs}
        onReference={vi.fn()}
        onApproval={vi.fn()}
        onAnswer={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(
      screen.getAllByRole("img", { name: "Codex 生成的图片" }),
    ).toHaveLength(1);
    const download = screen.getByRole("link", { name: "下载原图" });
    expect(download).toHaveAttribute("download", image.name);
    expect(download).toHaveAttribute("href", "blob:owned-image");
    fireEvent.click(
      screen.getByRole("button", { name: `放大图片：${image.name}` }),
    );
    expect(
      screen.getByRole("dialog", { name: "生成图片" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭图片预览" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores image-only replies without duplicate cards", () => {
    const runs = [record()];
    runs[0].run.partial_text = "";
    runs[0].events = runs[0].events.slice(1, 3);
    const current = {
      ...detail,
      messages: [{ ...detail.messages[0], content: "" }],
    };
    render(
      <ActivityFeed
        detail={current}
        runs={runs}
        onReference={vi.fn()}
        onApproval={vi.fn()}
        onAnswer={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "下载原图" })).toHaveLength(1);
  });

  it("settles unfinished image generation when a run is cancelled", () => {
    const run = record("cancelled");
    run.events = [run.events[1]];
    const item = buildDisplayTimeline({ ...detail, messages: [] }, [
      run,
    ]).entries.find((entry) => entry.kind === "image_generation");
    expect(item).toMatchObject({ generation: { status: "interrupted" } });
  });
});

function Settings({
  busy = false,
  mode = "agent",
  writable = true,
}: {
  busy?: boolean;
  mode?: "agent" | "plan";
  writable?: boolean;
}) {
  const [enabled, setEnabled] = useState(true);
  const controls = {
    agents: [{ id: "codex", name: "Codex", available: true }],
    agentId: "codex",
    setAgentId: vi.fn(),
    models: [{ id: "default", label: "默认" }],
    modelId: "default",
    setModelId: vi.fn(),
    modelVariants: [],
    modelVariant: "",
    setModelVariant: vi.fn(),
    harnessEfforts: [],
    harnessEffort: "",
    setHarnessEffort: vi.fn(),
    fastAvailable: false,
    fast: false,
    setFast: vi.fn(),
    reasoningEfforts: [],
    reasoningEffort: "",
    setReasoningEffort: vi.fn(),
    codexImageGeneration: enabled,
    setCodexImageGeneration: setEnabled,
    busy,
    mode,
    detail: null,
    create: vi.fn(),
    setError: vi.fn(),
  } as unknown as Parameters<typeof ComposerModels>[0]["controls"];
  return <ComposerModels controls={controls} writable={writable} />;
}

it("offers a default-on Codex switch even with the CLI default model", () => {
  render(<Settings />);
  fireEvent.click(screen.getByRole("button", { name: "运行设置" }));
  const toggle = screen.getByRole("switch", { name: "Codex 生图" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-checked", "false");
});

it.each([{ busy: true }, { mode: "plan" as const }, { writable: false }])(
  "freezes the image switch for restricted settings %o",
  (props) => {
    render(<Settings {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "运行设置" }));
    expect(screen.getByRole("switch", { name: "Codex 生图" })).toBeDisabled();
  },
);
