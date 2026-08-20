import { useEffect, useState } from "react";
import { LoaderCircle, Mic2, Trash2 } from "lucide-react";
import {
  ANNOTATION_LANGUAGES,
  languageColor,
  languageLabel,
  segmentLanguageCodes,
  transcriptionLanguageMatch,
  transcriptionTargetLanguageMatch,
} from "@features/audio-annotation/model";
import type {
  AudioAnnotationSegment,
  AudioAnnotationTranscriptionOption,
} from "@features/audio-annotation/types";
import { CustomSelect } from "@shared/ui/CustomSelect";
import "@features/audio-annotation/audio-annotation-language.css";

const PRIMARY_VERSION = "primary";

export type LanguageTranscriptionTarget = {
  version: string;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  label: string;
  text: string;
};

export type LanguageTranscriptionControls = {
  options: AudioAnnotationTranscriptionOption[];
  modelId: string;
  pending: boolean;
  disabledReason?: string;
  onModelChange: (modelId: string) => void;
  onTranscribe: (target: LanguageTranscriptionTarget) => void;
};

export function LanguageAnnotationEditor({
  segment,
  onChange,
  onFocus,
  onBlur,
  transcription,
}: {
  segment: AudioAnnotationSegment;
  onChange: (changes: Partial<AudioAnnotationSegment>, record: boolean) => void;
  onFocus: () => void;
  onBlur: () => void;
  transcription?: LanguageTranscriptionControls;
}) {
  const [activeVersion, setActiveVersion] = useState(PRIMARY_VERSION);
  const localizedTexts = segment.localized_texts ?? [];
  const activeLocalized = localizedTexts.find(
    (item) => item.language === activeVersion,
  );
  const activeText = activeLocalized?.text ?? segment.text;
  const usedLanguages = segmentLanguageCodes(segment);
  const activeLanguage =
    activeVersion === PRIMARY_VERSION
      ? (segment.language ?? null)
      : activeVersion;
  const activeLabel = activeLanguage ? languageLabel(activeLanguage) : "原文";
  const transcriptionOption = transcription?.options.find(
    (option) => option.id === transcription.modelId,
  );
  const isLocalizedVersion = activeVersion !== PRIMARY_VERSION;
  const defaultTranscriptionSourceLanguage = transcriptionLanguageMatch(
    transcriptionOption,
    segment.language ?? null,
  );
  const [sourceLanguage, setSourceLanguage] = useState(
    defaultTranscriptionSourceLanguage.value,
  );
  const sourceLanguageOptions =
    transcriptionOption?.parameter_capabilities.language_options ?? [];
  const transcriptionSourceLanguage =
    sourceLanguageOptions.find((option) => option.value === sourceLanguage) ??
    defaultTranscriptionSourceLanguage;
  const transcriptionTargetLanguage =
    isLocalizedVersion && activeLanguage
      ? transcriptionTargetLanguageMatch(transcriptionOption, activeLanguage)
      : null;
  const targetLanguageUnsupported = Boolean(
    transcriptionOption &&
    isLocalizedVersion &&
    activeLanguage &&
    !transcriptionTargetLanguage,
  );

  useEffect(() => {
    setSourceLanguage(defaultTranscriptionSourceLanguage.value);
  }, [
    defaultTranscriptionSourceLanguage.value,
    segment.id,
    transcription?.modelId,
  ]);

  useEffect(() => {
    if (
      !transcription ||
      transcription.pending ||
      !isLocalizedVersion ||
      !activeLanguage ||
      !targetLanguageUnsupported
    )
      return;
    const fallback = transcription.options.find((option) =>
      transcriptionTargetLanguageMatch(option, activeLanguage),
    );
    if (fallback && fallback.id !== transcription.modelId)
      transcription.onModelChange(fallback.id);
  }, [
    activeLanguage,
    isLocalizedVersion,
    targetLanguageUnsupported,
    transcription,
  ]);

  const addLanguage = (language: string) => {
    if (language === "add" || usedLanguages.includes(language)) return;
    onChange(
      {
        localized_texts: [...localizedTexts, { language, text: "" }],
      },
      true,
    );
    setActiveVersion(language);
  };

  const updateText = (text: string) => {
    if (activeVersion === PRIMARY_VERSION) {
      onChange({ text }, false);
      return;
    }
    onChange(
      {
        localized_texts: localizedTexts.map((item) =>
          item.language === activeVersion ? { ...item, text } : item,
        ),
      },
      false,
    );
  };

  const selectOutputLanguage = (language: string) => {
    if (language === PRIMARY_VERSION) {
      setActiveVersion(PRIMARY_VERSION);
      return;
    }
    if (!localizedTexts.some((item) => item.language === language)) {
      onChange(
        {
          localized_texts: [...localizedTexts, { language, text: "" }],
        },
        true,
      );
    }
    setActiveVersion(language);
  };

  const outputLanguageCodes = [
    ...new Set([
      ...localizedTexts.map((item) => item.language),
      ...ANNOTATION_LANGUAGES.filter(
        (language) => language.code !== segment.language,
      ).map((language) => language.code),
    ]),
  ];
  const outputLanguageOptions = [
    {
      value: PRIMARY_VERSION,
      label: segment.language
        ? `原文（${languageLabel(segment.language)}）`
        : "原文（不翻译）",
      description: "只识别语音，不请求翻译",
    },
    ...outputLanguageCodes.map((language) => {
      const target = transcriptionTargetLanguageMatch(
        transcriptionOption,
        language,
      );
      const exists = localizedTexts.some((item) => item.language === language);
      return {
        value: language,
        label: languageLabel(language),
        description: target
          ? `${exists ? "翻译并写入" : "创建并写入"}${languageLabel(language)}版本`
          : "所选模型不支持这个目标语言",
        disabled: !target,
      };
    }),
  ];

  return (
    <div className="annotation-language-editor">
      <div className="annotation-transcript-heading">
        <span>说话内容</span>
        <small>
          {usedLanguages.length
            ? `${usedLanguages.length} 个语言版本`
            : "原文语言未指定"}
        </small>
      </div>

      <section
        className="annotation-language-versions"
        aria-label="多语言说话内容"
      >
        <div className="annotation-language-version-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeVersion === PRIMARY_VERSION}
            className={
              segment.language
                ? `language-${languageColor(segment.language)}`
                : "language-neutral"
            }
            onClick={() => setActiveVersion(PRIMARY_VERSION)}
          >
            <i />
            {segment.language ? languageLabel(segment.language) : "原文"}
          </button>
          {localizedTexts.map((item) => (
            <button
              type="button"
              role="tab"
              key={item.language}
              aria-selected={activeVersion === item.language}
              className={`language-${languageColor(item.language)}`}
              onClick={() => setActiveVersion(item.language)}
            >
              <i />
              {languageLabel(item.language)}
            </button>
          ))}
          <CustomSelect
            ariaLabel="添加语言版本"
            className="annotation-add-language"
            value="add"
            options={[
              { value: "add", label: "+ 添加语言" },
              ...ANNOTATION_LANGUAGES.map((language) => ({
                value: language.code,
                label: language.label,
                description: `为当前音频片段添加${language.label}文本`,
                disabled: usedLanguages.includes(language.code),
              })),
            ]}
            onChange={addLanguage}
          />
        </div>

        <div className="annotation-language-version-toolbar">
          {activeVersion === PRIMARY_VERSION ? (
            <>
              <span>原文语言</span>
              <CustomSelect
                ariaLabel="选择原文语言"
                value={segment.language ?? "unassigned"}
                options={[
                  { value: "unassigned", label: "未指定语言" },
                  ...ANNOTATION_LANGUAGES.map((language) => ({
                    value: language.code,
                    label: language.label,
                    disabled: localizedTexts.some(
                      (item) => item.language === language.code,
                    ),
                  })),
                ]}
                onChange={(language) =>
                  onChange(
                    {
                      language: language === "unassigned" ? null : language,
                    },
                    true,
                  )
                }
              />
            </>
          ) : (
            <>
              <span>
                当前编辑：<strong>{activeLabel}</strong>
              </span>
              <button
                type="button"
                className="annotation-delete-language"
                aria-label={`删除${activeLabel}版本`}
                onClick={() => {
                  onChange(
                    {
                      localized_texts: localizedTexts.filter(
                        (item) => item.language !== activeVersion,
                      ),
                    },
                    true,
                  );
                  setActiveVersion(PRIMARY_VERSION);
                }}
              >
                <Trash2 aria-hidden /> 删除此版本
              </button>
            </>
          )}
        </div>

        <div className="annotation-transcript-input">
          <textarea
            value={activeText}
            maxLength={20_000}
            aria-label={`${activeLabel}说话内容`}
            placeholder={`输入这个片段的${activeLabel}内容…`}
            onFocus={onFocus}
            onChange={(event) => updateText(event.target.value)}
            onBlur={onBlur}
          />
          <small>{activeText.length} 字</small>
        </div>
        {transcription ? (
          <div className="annotation-segment-transcription">
            <div className="annotation-segment-transcription-controls">
              <CustomSelect
                ariaLabel="选择片段转写模型"
                className="annotation-transcription-model"
                value={transcription.modelId}
                disabled={
                  transcription.pending || !transcription.options.length
                }
                options={
                  transcription.options.length
                    ? transcription.options.map((option) => ({
                        value: option.id,
                        label: option.label,
                        description:
                          isLocalizedVersion &&
                          activeLanguage &&
                          !transcriptionTargetLanguageMatch(
                            option,
                            activeLanguage,
                          )
                            ? `${option.provider_name} · 不支持转写为${activeLabel}`
                            : `${option.provider_name} · 最多 ${Math.round(option.max_input_bytes / 1024 / 1024)} MB`,
                        disabled:
                          isLocalizedVersion &&
                          Boolean(activeLanguage) &&
                          !transcriptionTargetLanguageMatch(
                            option,
                            activeLanguage,
                          ),
                      }))
                    : [{ value: "", label: "没有可用的语音识别模型" }]
                }
                onChange={transcription.onModelChange}
              />
              <button
                type="button"
                className="btn annotation-transcribe-segment"
                disabled={
                  transcription.pending ||
                  !transcriptionOption ||
                  targetLanguageUnsupported ||
                  Boolean(transcription.disabledReason)
                }
                aria-label={`转写当前片段到${activeLabel}`}
                onClick={() =>
                  transcription.onTranscribe({
                    version: activeVersion,
                    sourceLanguage: transcriptionSourceLanguage.value,
                    targetLanguage: isLocalizedVersion ? activeLanguage : null,
                    label: activeLabel,
                    text: activeText,
                  })
                }
              >
                {transcription.pending ? (
                  <LoaderCircle className="spinning" aria-hidden />
                ) : (
                  <Mic2 aria-hidden />
                )}
                {transcription.pending ? "正在转写…" : "转写当前片段"}
              </button>
            </div>
            <div
              className="annotation-transcription-language-controls"
              aria-label="片段转写语言设置"
            >
              <div className="annotation-transcription-language-field">
                <span>原语言</span>
                <CustomSelect
                  ariaLabel="选择转写原语言"
                  value={transcriptionSourceLanguage.value}
                  disabled={transcription.pending || !transcriptionOption}
                  options={
                    sourceLanguageOptions.length
                      ? sourceLanguageOptions
                      : [{ value: "auto", label: "自动识别" }]
                  }
                  onChange={setSourceLanguage}
                />
              </div>
              <span
                className="annotation-transcription-language-arrow"
                aria-hidden
              >
                →
              </span>
              <div className="annotation-transcription-language-field">
                <span>目标语言</span>
                <CustomSelect
                  ariaLabel="选择转写目标语言"
                  value={activeVersion}
                  disabled={transcription.pending || !transcriptionOption}
                  options={outputLanguageOptions}
                  onChange={selectOutputLanguage}
                />
              </div>
            </div>
            <small>
              {transcription.disabledReason ??
                (!transcription.options.length
                  ? "请先在模型服务中启用支持语音识别的模型。"
                  : targetLanguageUnsupported
                    ? `所选模型不支持转写为${activeLabel}。`
                    : isLocalizedVersion && transcriptionTargetLanguage
                      ? `模型将按${transcriptionSourceLanguage.label}识别语音并翻译为${transcriptionTargetLanguage.label}。`
                      : transcriptionSourceLanguage.value.toLocaleLowerCase() ===
                          "auto"
                        ? "模型将自动识别语音语言。"
                        : `模型将按${transcriptionSourceLanguage.label}识别当前片段。`)}
            </small>
          </div>
        ) : null}
        <p className="annotation-language-help">
          每个语言版本共用当前片段的时间范围和说话人。
        </p>
      </section>
    </div>
  );
}
