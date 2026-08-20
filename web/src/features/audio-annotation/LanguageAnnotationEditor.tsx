import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  ANNOTATION_LANGUAGES,
  languageColor,
  languageLabel,
  segmentLanguageCodes,
} from "@features/audio-annotation/model";
import type { AudioAnnotationSegment } from "@features/audio-annotation/types";
import { CustomSelect } from "@shared/ui/CustomSelect";

const PRIMARY_VERSION = "primary";

export function LanguageAnnotationEditor({
  segment,
  onChange,
  onFocus,
  onBlur,
}: {
  segment: AudioAnnotationSegment;
  onChange: (changes: Partial<AudioAnnotationSegment>, record: boolean) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [activeVersion, setActiveVersion] = useState(PRIMARY_VERSION);
  const localizedTexts = segment.localized_texts ?? [];
  const activeLocalized = localizedTexts.find(
    (item) => item.language === activeVersion,
  );
  const activeText = activeLocalized?.text ?? segment.text;
  const usedLanguages = segmentLanguageCodes(segment);
  const activeLanguage =
    activeVersion === PRIMARY_VERSION ? segment.language : activeVersion;
  const activeLabel = activeLanguage ? languageLabel(activeLanguage) : "原文";

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
        <p className="annotation-language-help">
          每个语言版本共用当前片段的时间范围和说话人。
        </p>
      </section>
    </div>
  );
}
