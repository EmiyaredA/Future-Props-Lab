import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AudioAnnotationEmotionField } from "@features/audio-annotation/AudioAnnotationEmotionField";

function EmotionHarness() {
  const [emotion, setEmotion] = useState<string | null>(null);
  return (
    <>
      <AudioAnnotationEmotionField emotion={emotion} onChange={setEmotion} />
      <output aria-label="当前情绪">{emotion ?? "未标注"}</output>
    </>
  );
}

test("selects a preset emotion, accepts a custom value, and clears it", async () => {
  const user = userEvent.setup();
  render(<EmotionHarness />);

  await user.click(screen.getByRole("button", { name: "愤怒" }));
  expect(screen.getByLabelText("当前情绪")).toHaveTextContent("愤怒");
  expect(screen.getByRole("button", { name: "愤怒" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await user.type(
    screen.getByRole("textbox", { name: "自定义情绪" }),
    "  克制的兴奋  ",
  );
  await user.click(screen.getByRole("button", { name: "使用" }));
  expect(screen.getByLabelText("当前情绪")).toHaveTextContent("克制的兴奋");

  await user.click(screen.getByRole("button", { name: "未标注" }));
  expect(screen.getByLabelText("当前情绪")).toHaveTextContent("未标注");
});
