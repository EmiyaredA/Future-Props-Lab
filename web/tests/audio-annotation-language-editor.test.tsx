import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { LanguageAnnotationEditor } from "@features/audio-annotation/LanguageAnnotationEditor";
import type { AudioAnnotationSegment } from "@features/audio-annotation/types";
import type { AudioAnnotationTranscriptionOption } from "@features/audio-annotation/types";

const transcriptionOption: AudioAnnotationTranscriptionOption = {
  id: "asr-model",
  provider_id: "provider",
  provider_name: "识别供应商",
  provider_kind: "openai",
  slug: "whisper",
  label: "片段识别模型",
  description: "",
  max_input_bytes: 10 * 1024 * 1024,
  parameter_capabilities: {
    language_mode: "select",
    language_options: [
      { value: "auto", label: "自动识别" },
      { value: "zh", label: "中文" },
      { value: "ja", label: "日本語" },
    ],
    target_language_options: [],
    supports_word_timestamps: false,
    supports_text_edit: false,
    supports_speaker_diarization: false,
    supports_max_speakers: false,
    supports_punctuation: false,
    supports_hotwords: false,
    supports_abbreviations: false,
    defaults: {
      language: "auto",
      target_language: null,
      enable_word_timestamps: false,
      enable_text_edit: false,
      enable_speaker_diarization: false,
      max_speakers: null,
      enable_punctuation: false,
      hotwords: null,
      abbreviations: false,
    },
  },
};

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

function TranscriptionHarness({
  onTranscribe,
}: {
  onTranscribe: ReturnType<typeof vi.fn>;
}) {
  const [segment, setSegment] = useState<AudioAnnotationSegment>({
    id: "segment-1",
    start_ms: 0,
    end_ms: 1_000,
    speaker_id: null,
    text: "うわっ！",
    language: "ja",
    localized_texts: [{ language: "zh", text: "哇！" }],
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
      transcription={{
        options: [transcriptionOption],
        modelId: transcriptionOption.id,
        pending: false,
        onModelChange: vi.fn(),
        onTranscribe,
      }}
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

test("transcribes into the active language version with the matched model language", async () => {
  const user = userEvent.setup();
  const onTranscribe = vi.fn();
  render(<TranscriptionHarness onTranscribe={onTranscribe} />);

  expect(screen.getByText("模型将按日本語识别当前片段。")).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "中文" }));
  expect(screen.getByText("模型将按中文识别当前片段。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "转写当前片段到中文" }));

  expect(onTranscribe).toHaveBeenCalledWith({
    version: "zh",
    language: "zh",
    label: "中文",
    text: "哇！",
  });
});
