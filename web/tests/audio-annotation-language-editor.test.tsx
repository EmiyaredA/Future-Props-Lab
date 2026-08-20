import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { LanguageAnnotationEditor } from "@features/audio-annotation/LanguageAnnotationEditor";
import type { AudioAnnotationSegment } from "@features/audio-annotation/types";

function LanguageEditorHarness() {
  const [segment, setSegment] = useState<AudioAnnotationSegment>({
    id: "segment-1",
    start_ms: 0,
    end_ms: 1_000,
    speaker_id: null,
    text: "うわっ！",
    language: null,
    localized_texts: [],
    status: "draft",
  });
  return (
    <LanguageAnnotationEditor
      segment={segment}
      onChange={(changes) =>
        setSegment((current) => ({ ...current, ...changes }))
      }
      onFocus={vi.fn()}
      onBlur={vi.fn()}
    />
  );
}

test("assigns the original language and adds another text version", async () => {
  const user = userEvent.setup();
  render(<LanguageEditorHarness />);

  await user.click(screen.getByRole("combobox", { name: "选择原文语言" }));
  await user.click(screen.getByRole("option", { name: "日语" }));
  expect(screen.getByRole("tab", { name: "日语" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await user.click(screen.getByRole("combobox", { name: "添加语言版本" }));
  await user.click(
    screen.getByRole("option", {
      name: /中文 为当前音频片段添加中文文本/,
    }),
  );
  const chinese = screen.getByRole("textbox", { name: "中文说话内容" });
  await user.type(chinese, "哇！");

  expect(screen.getByRole("tab", { name: "中文" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(chinese).toHaveValue("哇！");
  expect(screen.getByText("2 个语言版本")).toBeInTheDocument();
});
