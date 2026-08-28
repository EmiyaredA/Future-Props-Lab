import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audioAnnotationQueryKeys } from "@features/audio-annotation/queryKeys";
import { modelQueryKeys } from "@features/models/queryKeys";
import { visualWorkshopQueryKeys } from "@features/visual-workshop/queryKeys";
import {
  ApiError,
  apiErrorMessage,
  parseProblemDetail,
  problemDetailMessage,
} from "@platform/api/errors";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";
import {
  prependProject,
  removeProject,
  upsertProject,
} from "@shared/ui/project-library";
import { fetchApiBlob } from "@platform/api/client";

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn(),
}));

const fetchBlobMock = vi.mocked(fetchApiBlob);

afterEach(() => {
  vi.restoreAllMocks();
  fetchBlobMock.mockReset();
});

describe("feature query key owners", () => {
  it("builds stable model, visual workshop, and annotation keys", () => {
    expect(modelQueryKeys.conversation("chat-1")).toEqual([
      "model-test-conversation",
      "chat-1",
    ]);
    expect(visualWorkshopQueryKeys.canvas("project-1")).toEqual([
      "visual-workshop-canvas",
      "project-1",
    ]);
    expect(audioAnnotationQueryKeys.projectList("访谈")).toEqual([
      "audio-annotation-projects",
      "访谈",
    ]);
  });
});

describe("problem detail text", () => {
  it("reads string and nested detail without leaking object coercion", () => {
    expect(problemDetailMessage({ detail: "名称冲突" })).toBe("名称冲突");
    expect(problemDetailMessage({ detail: { message: "上传失败" } })).toBe(
      "上传失败",
    );
    expect(problemDetailMessage(parseProblemDetail(null), "兜底")).toBe("兜底");
    expect(
      apiErrorMessage(
        new ApiError("", { detail: { detail: "修订冲突" } }, 409),
      ),
    ).toBe("修订冲突");
  });
});

describe("project collection rules", () => {
  const first = { id: "one", title: "一" };
  const second = { id: "two", title: "二" };

  it("prepends, moves an updated item to the front, and removes by id", () => {
    expect(prependProject(undefined, first).items).toEqual([first]);
    expect(
      upsertProject({ items: [first, second] }, { ...second, title: "二改" })
        .items,
    ).toEqual([{ ...second, title: "二改" }, first]);
    expect(removeProject({ items: [first, second] }, "one").items).toEqual([
      second,
    ]);
  });
});

function BlobProbe({ path }: { path: string | null }) {
  const state = useApiBlobUrl(path);
  return (
    <output>
      {state.loading ? "loading" : state.error ? "error" : state.url || "empty"}
    </output>
  );
}

describe("authenticated blob URL hook", () => {
  it("keeps the newest request and revokes its object URL on cleanup", async () => {
    let resolveFirst!: (blob: Blob) => void;
    let resolveSecond!: (blob: Blob) => void;
    fetchBlobMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );
    const createObjectUrl = vi.fn(() => "blob:newest");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    const view = render(<BlobProbe path="/first" />);
    view.rerender(<BlobProbe path="/second" />);
    await act(async () => resolveSecond(new Blob(["second"])));
    expect(screen.getByText("blob:newest")).toBeInTheDocument();
    await act(async () => resolveFirst(new Blob(["first"])));
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:newest");
  });
});
