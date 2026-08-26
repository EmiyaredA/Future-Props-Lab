import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { dialogueBoxPresetStyle } from "@features/galgame-workshop/api";
import { DialogueFontScaleField } from "@features/galgame-workshop/editor/DialogueFontScaleField";

test("updates project-wide and explicit dialogue font sizes", () => {
  const onScaleChange = vi.fn();
  const onBodyFontSizeChange = vi.fn();
  const onNameFontSizeChange = vi.fn();
  render(
    <DialogueFontScaleField
      style={dialogueBoxPresetStyle("classicGradient")}
      onScaleChange={onScaleChange}
      onBodyFontSizeChange={onBodyFontSizeChange}
      onNameFontSizeChange={onNameFontSizeChange}
    />,
  );

  fireEvent.change(screen.getByLabelText("对话框整体字体大小"), {
    target: { value: "1.15" },
  });
  fireEvent.change(screen.getByLabelText("对话框正文字号"), {
    target: { value: "31" },
  });
  fireEvent.change(screen.getByLabelText("对话框人物名字号"), {
    target: { value: "25" },
  });

  expect(onScaleChange).toHaveBeenCalledWith(1.15);
  expect(onBodyFontSizeChange).toHaveBeenCalledWith(31);
  expect(onNameFontSizeChange).toHaveBeenCalledWith(25);
});
