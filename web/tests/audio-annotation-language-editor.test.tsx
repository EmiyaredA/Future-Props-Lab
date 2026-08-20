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
  provider_kind: "senseaudio_asr",
  slug: "senseaudio-asr-pro-1.5-260319",
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
    target_language_options: [
      { value: "zh", label: "中文" },
      { value: "ja", label: "日本語" },
    ],
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
  option = transcriptionOption,
  localizedTexts = [{ language: "zh", text: "哇！" }],
}: {
  onTranscribe: ReturnType<typeof vi.fn>;
  option?: AudioAnnotationTranscriptionOption;
  localizedTexts?: AudioAnnotationSegment["localized_texts"];
}) {
  const [segment, setSegment] = useState<AudioAnnotationSegment>({
    id: "segment-1",
    start_ms: 0,
    end_ms: 1_000,
    speaker_id: null,
    text: "うわっ！",
    language: "ja",
    localized_texts: localizedTexts,
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
        options: [option],
        modelId: option.id,
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

test("uses the original language for transcription and target language only for translations", async () => {
  const user = userEvent.setup();
  const onTranscribe = vi.fn();
  render(<TranscriptionHarness onTranscribe={onTranscribe} />);

  const sourceLanguage = screen.getByRole("combobox", {
    name: "选择转写原语言",
  });
  const outputLanguage = screen.getByRole("combobox", {
    name: "选择转写目标语言",
  });
  expect(sourceLanguage).toHaveTextContent("日本語");
  expect(outputLanguage).toHaveTextContent("原文（日语）");

  await user.click(sourceLanguage);
  await user.click(screen.getByRole("option", { name: "自动识别" }));
  expect(screen.getByText("模型将自动识别语音语言。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "转写当前片段到日语" }));
  expect(onTranscribe).toHaveBeenLastCalledWith({
    version: "primary",
    sourceLanguage: "auto",
    targetLanguage: null,
    label: "日语",
    text: "うわっ！",
  });

  await user.click(sourceLanguage);
  await user.click(screen.getByRole("option", { name: "日本語" }));
  expect(screen.getByText("模型将按日本語识别当前片段。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "转写当前片段到日语" }));
  expect(onTranscribe).toHaveBeenLastCalledWith({
    version: "primary",
    sourceLanguage: "ja",
    targetLanguage: null,
    label: "日语",
    text: "うわっ！",
  });

  await user.click(outputLanguage);
  await user.click(
    screen.getByRole("option", { name: /中文 翻译并写入中文版本/ }),
  );
  expect(screen.getByRole("tab", { name: "中文" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByText("模型将按日本語识别语音并翻译为中文。"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "转写当前片段到中文" }));

  expect(onTranscribe).toHaveBeenLastCalledWith({
    version: "zh",
    sourceLanguage: "ja",
    targetLanguage: "zh",
    label: "中文",
    text: "哇！",
  });
});

test("allows original transcription but blocks translation when the target language is unsupported", async () => {
  const user = userEvent.setup();
  const onTranscribe = vi.fn();
  const unsupportedOption: AudioAnnotationTranscriptionOption = {
    ...transcriptionOption,
    id: "asr-without-translation",
    parameter_capabilities: {
      ...transcriptionOption.parameter_capabilities,
      target_language_options: [],
    },
  };
  render(
    <TranscriptionHarness
      onTranscribe={onTranscribe}
      option={unsupportedOption}
    />,
  );

  expect(screen.getByText("模型将按日本語识别当前片段。")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "转写当前片段到日语" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("combobox", { name: "选择转写目标语言" }));
  expect(
    screen.getByRole("option", {
      name: /中文 所选模型不支持这个目标语言/,
    }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("tab", { name: "中文" }));
  expect(screen.getByText("所选模型不支持转写为中文。")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "转写当前片段到中文" }),
  ).toBeDisabled();
});

test("creates a missing language version from the target language control", async () => {
  const user = userEvent.setup();
  const onTranscribe = vi.fn();
  render(
    <TranscriptionHarness onTranscribe={onTranscribe} localizedTexts={[]} />,
  );

  await user.click(screen.getByRole("combobox", { name: "选择转写目标语言" }));
  await user.click(
    screen.getByRole("option", { name: /中文 创建并写入中文版本/ }),
  );

  expect(screen.getByRole("tab", { name: "中文" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("textbox", { name: "中文说话内容" })).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "转写当前片段到中文" }));
  expect(onTranscribe).toHaveBeenCalledWith({
    version: "zh",
    sourceLanguage: "ja",
    targetLanguage: "zh",
    label: "中文",
    text: "",
  });
});
