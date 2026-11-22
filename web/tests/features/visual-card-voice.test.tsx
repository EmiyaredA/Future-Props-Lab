import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CardVoice } from "../../src/features/visual-workshop/creative/CardVoice";

vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: (path?: string) => ({
    url: path ? "blob:voice" : "",
    loading: false,
    error: null,
  }),
}));

test("bound voice plays in read-only mode without exposing write controls", () => {
  render(
    <CardVoice
      title="琉华"
      assetId="voice"
      readOnly
      busy={false}
      onChoose={vi.fn()}
      onUpload={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("琉华的角色语音")).toHaveAttribute(
    "src",
    "blob:voice",
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("voice selection, upload, and unbinding remain explicit draft operations", async () => {
  const choose = vi.fn(),
    upload = vi.fn(),
    remove = vi.fn();
  render(
    <CardVoice
      title="琉华"
      assetId="voice"
      readOnly={false}
      busy={false}
      onChoose={choose}
      onUpload={upload}
      onRemove={remove}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "选择角色语音" }));
  expect(choose).toHaveBeenCalledOnce();
  const file = new File(["wave"], "voice.wav", { type: "audio/wav" });
  fireEvent.change(screen.getByLabelText("上传角色语音"), {
    target: { files: [file] },
  });
  expect(upload).toHaveBeenCalledWith(file);
  await userEvent.click(screen.getByRole("button", { name: "解除语音绑定" }));
  expect(remove).toHaveBeenCalledOnce();
});

test("pending save/upload disables voice mutations", () => {
  render(
    <CardVoice
      title="琉华"
      assetId="voice"
      readOnly={false}
      busy
      onChoose={vi.fn()}
      onUpload={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  for (const button of screen.getAllByRole("button"))
    expect(button).toBeDisabled();
});
