import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AudioAnnotationEmotionField } from "@features/audio-annotation/AudioAnnotationEmotionField";
import type { CustomEmotionEntry } from "@features/audio-annotation/emotions";
import type { SpeakerEmotionEntry } from "@features/audio-annotation/model";

const speakers = [
  { id: "a", name: "冈部伦太郎", color: "#28B8A7" },
  { id: "b", name: "牧濑红莉栖", color: "#4C8FE8" },
];

function EmotionHarness({
  initialEmotions = [],
  initialCustomEmotions = [],
}: {
  initialEmotions?: SpeakerEmotionEntry[];
  initialCustomEmotions?: CustomEmotionEntry[];
}) {
  const [emotions, setEmotions] = useState(initialEmotions);
  const [customEmotions, setCustomEmotions] = useState(initialCustomEmotions);
  const [managerOpen, setManagerOpen] = useState(false);
  return (
    <>
      <AudioAnnotationEmotionField
        speakers={speakers}
        speakerIds={speakers.map((speaker) => speaker.id)}
        speakerEmotions={emotions}
        customEmotions={customEmotions}
        onChange={(next) => {
          setEmotions(next.speaker_emotions);
          if (next.custom_emotions) setCustomEmotions(next.custom_emotions);
        }}
        onManage={() => setManagerOpen(true)}
      />
      <output aria-label="当前情绪">
        {emotions.length
          ? emotions
              .map((item) => `${item.speaker_id}:${item.emotion}`)
              .join("|")
          : "未标注"}
      </output>
      <output aria-label="自定义词库">
        {customEmotions.map((item) => item.name).join("|") || "空"}
      </output>
      <output aria-label="管理状态">{managerOpen ? "open" : "closed"}</output>
    </>
  );
}

test("binds emotion to selected speakers and supports select-all", async () => {
  const user = userEvent.setup();
  render(<EmotionHarness />);

  await user.click(screen.getByRole("button", { name: "牧濑红莉栖" }));
  await user.click(screen.getByRole("combobox", { name: "选择片段情绪" }));
  await user.click(
    within(screen.getByRole("listbox", { name: "选择片段情绪" })).getByRole(
      "option",
      { name: "愤怒" },
    ),
  );
  expect(screen.getByLabelText("当前情绪")).toHaveTextContent("a:愤怒");

  await user.click(screen.getByRole("button", { name: "全选" }));
  await user.click(screen.getByRole("combobox", { name: "选择片段情绪" }));
  await user.click(
    within(screen.getByRole("listbox", { name: "选择片段情绪" })).getByRole(
      "option",
      { name: "开心" },
    ),
  );
  expect(screen.getByLabelText("当前情绪")).toHaveTextContent("a:开心|b:开心");

  await user.type(
    screen.getByRole("textbox", { name: "自定义情绪" }),
    "克制的兴奋",
  );
  await user.click(screen.getByRole("button", { name: "使用" }));
  expect(screen.getByLabelText("当前情绪")).toHaveTextContent(
    "a:克制的兴奋|b:克制的兴奋",
  );
  expect(screen.getByLabelText("自定义词库")).toHaveTextContent("克制的兴奋");
});

test("warns when quick-add duplicates preset or custom vocabulary", async () => {
  const user = userEvent.setup();
  render(
    <EmotionHarness
      initialCustomEmotions={[{ name: "克制的兴奋", color: "#28B8A7" }]}
    />,
  );

  await user.type(screen.getByRole("textbox", { name: "自定义情绪" }), "开心");
  await user.click(screen.getByRole("button", { name: "使用" }));
  expect(screen.getByLabelText("情绪词库提示")).toHaveTextContent(
    "「开心」已在预设中",
  );
  expect(screen.getByLabelText("当前情绪")).toHaveTextContent("a:开心|b:开心");
  expect(screen.getByLabelText("自定义词库")).toHaveTextContent("克制的兴奋");

  await user.clear(screen.getByRole("textbox", { name: "自定义情绪" }));
  await user.type(
    screen.getByRole("textbox", { name: "自定义情绪" }),
    "克制的兴奋",
  );
  await user.click(screen.getByRole("button", { name: "使用" }));
  expect(screen.getByLabelText("情绪词库提示")).toHaveTextContent(
    "「克制的兴奋」已在词库中",
  );
  expect(screen.getByLabelText("自定义词库")).toHaveTextContent("克制的兴奋");
});

test("opens emotion manager from trailing action", async () => {
  const user = userEvent.setup();
  render(<EmotionHarness />);
  expect(screen.getByLabelText("管理状态")).toHaveTextContent("closed");
  await user.click(screen.getByRole("button", { name: "管理" }));
  expect(screen.getByLabelText("管理状态")).toHaveTextContent("open");
});

test("disables emotion edits when no speakers are bound", async () => {
  const user = userEvent.setup();
  render(
    <AudioAnnotationEmotionField
      speakers={speakers}
      speakerIds={[]}
      speakerEmotions={[]}
      customEmotions={[]}
      onChange={() => {
        throw new Error("should not write");
      }}
      onManage={() => {
        throw new Error("should not manage");
      }}
    />,
  );

  expect(
    screen.getByText("请先为片段选择说话人，再标注情绪。"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "选择片段情绪" }));
  await user.click(
    within(screen.getByRole("listbox", { name: "选择片段情绪" })).getByRole(
      "option",
      { name: "愤怒" },
    ),
  );
});
