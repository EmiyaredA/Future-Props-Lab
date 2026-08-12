import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Languages,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  GalgameStoryChapter,
  GalgameStoryFragment,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import {
  COMMON_STORY_LOCALES,
  DEFAULT_TARGET_LOCALE,
  addLocalizationTarget,
  canonicalStoryLocale,
  isStoryLocale,
  localizationEntry,
  localizationStatus,
  removeLocalizationTarget,
  setLocalizationDefaultLocale,
  storyFragmentTranslationUnits,
  storyLocaleLabel,
  storyLocalizations,
  storyTranslationUnits,
  updateLocalizationEntry,
  type StoryTranslationUnit,
} from "@features/galgame-workshop/editor/localization";
import { CustomSelect } from "@shared/ui/CustomSelect";

type StoryLocalizationWorkspaceProps = {
  document: GalgameStoryProject;
  chapter: GalgameStoryChapter;
  fragment: GalgameStoryFragment;
  targetLocale: string;
  selectedBlockId?: string;
  onTargetLocaleChange: (locale: string) => void;
  onSelectBlock: (blockId: string) => void;
  onDocument: (document: GalgameStoryProject) => void;
};

const STATUS_LABEL = {
  missing: "待翻译",
  stale: "待复核",
  translated: "已翻译",
} as const;

function translationTypeLabel(unit: StoryTranslationUnit) {
  const blockLabels: Partial<
    Record<StoryTranslationUnit["blockType"], string>
  > = {
    dialogue: "对白",
    narration: "旁白",
    storyParagraph: "段落",
    floatingText: "浮动文字",
    systemMessage: "系统消息",
    branch: "分支",
    endChapter: "结局",
  };
  const blockLabel = blockLabels[unit.blockType] ?? unit.blockType;
  return unit.label === "正文" ? blockLabel : `${blockLabel} · ${unit.label}`;
}

export function StoryLocalizationWorkspace({
  document,
  chapter,
  fragment,
  targetLocale,
  selectedBlockId,
  onTargetLocaleChange,
  onSelectBlock,
  onDocument,
}: StoryLocalizationWorkspaceProps) {
  const [localeDraft, setLocaleDraft] = useState("");
  const [localeMessage, setLocaleMessage] = useState("");
  const localizations = storyLocalizations(document);
  const fragmentUnits = useMemo(
    () => storyFragmentTranslationUnits(fragment),
    [fragment],
  );
  const allUnits = useMemo(() => storyTranslationUnits(document), [document]);
  const target = localizations.targets?.find(
    (item) => item.locale.toLowerCase() === targetLocale.toLowerCase(),
  );
  const progress = allUnits.reduce(
    (result, unit) => {
      const status = localizationStatus(
        localizationEntry(document, targetLocale, unit),
        unit,
      );
      result[status] += 1;
      return result;
    },
    { missing: 0, stale: 0, translated: 0 },
  );
  const percent = allUnits.length
    ? Math.round((progress.translated / allUnits.length) * 100)
    : 100;
  const selectableTargets = localizations.targets?.length
    ? localizations.targets
    : [{ locale: DEFAULT_TARGET_LOCALE, entries: [] }];

  useEffect(() => {
    const targets = localizations.targets ?? [];
    if (
      !targets.length ||
      targets.some(
        (item) => item.locale.toLowerCase() === targetLocale.toLowerCase(),
      )
    )
      return;
    const defaultTarget = targets.find(
      (item) =>
        item.locale.toLowerCase() === localizations.defaultLocale.toLowerCase(),
    );
    onTargetLocaleChange(defaultTarget?.locale ?? targets[0].locale);
  }, [
    localizations.defaultLocale,
    localizations.targets,
    onTargetLocaleChange,
    targetLocale,
  ]);

  const addLocale = (requestedLocale: string) => {
    const locale = canonicalStoryLocale(requestedLocale);
    if (!isStoryLocale(locale)) {
      setLocaleMessage("请输入合法的 BCP-47 语言标签，例如 es-ES。");
      return;
    }
    if (locale.toLowerCase() === localizations.sourceLocale.toLowerCase()) {
      setLocaleMessage("目标语言不能与源语言相同。");
      return;
    }
    const next = addLocalizationTarget(document, locale);
    if (next === document) {
      onTargetLocaleChange(locale);
      setLocaleMessage("该语言已经在项目中。");
      return;
    }
    onDocument(next);
    onTargetLocaleChange(locale);
    setLocaleDraft("");
    setLocaleMessage("");
  };

  return (
    <section className="galgame-localization-workspace">
      <header className="galgame-localization-heading">
        <div>
          <span className="galgame-localization-kicker">
            <Languages aria-hidden /> 多语言编辑
          </span>
          <h2>
            译稿校对台{" "}
            <small>
              {chapter.title} / {fragment.title}
            </small>
          </h2>
          <p>译文引用原 Block ID；源文改动后会保留旧译文并标记为待复核。</p>
        </div>
      </header>

      <div className="galgame-localization-progress-card">
        <strong>{percent}%</strong>
        <span>
          {progress.translated} / {allUnits.length} 已完成
        </span>
        <div
          className="galgame-localization-progress"
          aria-label={`翻译完成 ${percent}%`}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
        {progress.stale ? (
          <span className="is-stale">
            <AlertTriangle aria-hidden /> {progress.stale} 条待复核
          </span>
        ) : null}
        <label>
          游戏启动语言
          <CustomSelect
            ariaLabel="游戏启动语言"
            value={localizations.defaultLocale}
            onChange={(value) =>
              onDocument(setLocalizationDefaultLocale(document, value))
            }
            options={[
              {
                value: localizations.sourceLocale,
                label: `${storyLocaleLabel(localizations.sourceLocale)} · ${localizations.sourceLocale}`,
              },
              ...(localizations.targets ?? []).map((item) => ({
                value: item.locale,
                label: `${storyLocaleLabel(item.locale)} · ${item.locale}`,
              })),
            ]}
          />
        </label>
      </div>

      <div className="galgame-localization-language-bar">
        <label>
          当前译文
          <CustomSelect
            ariaLabel="当前目标语言"
            value={targetLocale}
            onChange={onTargetLocaleChange}
            options={selectableTargets.map((item) => ({
              value: item.locale,
              label: `${storyLocaleLabel(item.locale)} · ${item.locale}`,
            }))}
          />
        </label>
        <details>
          <summary>
            <Plus aria-hidden /> 添加语言
          </summary>
          <div className="galgame-localization-add-language">
            <div>
              {COMMON_STORY_LOCALES.filter(
                (preset) =>
                  preset.locale.toLowerCase() !==
                    localizations.sourceLocale.toLowerCase() &&
                  !(localizations.targets ?? []).some(
                    (item) =>
                      item.locale.toLowerCase() === preset.locale.toLowerCase(),
                  ),
              ).map((preset) => (
                <button
                  type="button"
                  key={preset.locale}
                  onClick={() => addLocale(preset.locale)}
                >
                  {preset.label} <small>{preset.locale}</small>
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addLocale(localeDraft);
              }}
            >
              <input
                aria-label="自定义语言标签"
                value={localeDraft}
                onChange={(event) => setLocaleDraft(event.target.value)}
                placeholder="例如 es-ES"
              />
              <button type="submit">添加</button>
            </form>
            {localeMessage ? <p>{localeMessage}</p> : null}
          </div>
        </details>
        {target ? (
          <button
            type="button"
            className="galgame-localization-delete"
            onClick={() => {
              const nextTargets = (localizations.targets ?? []).filter(
                (item) => item.locale !== target.locale,
              );
              onDocument(removeLocalizationTarget(document, target.locale));
              onTargetLocaleChange(
                nextTargets[0]?.locale ?? DEFAULT_TARGET_LOCALE,
              );
            }}
          >
            <Trash2 aria-hidden /> 删除该语言
          </button>
        ) : null}
      </div>

      <div className="galgame-localization-table-head" aria-hidden>
        <strong>源文 · {localizations.sourceLocale}</strong>
        <strong>译文 · {targetLocale}</strong>
      </div>
      <div className="galgame-localization-list">
        {fragmentUnits.length ? (
          fragmentUnits.map((unit, index) => {
            const entry = localizationEntry(document, targetLocale, unit);
            const status = localizationStatus(entry, unit);
            return (
              <article
                key={unit.key}
                className={`galgame-localization-row${selectedBlockId === unit.blockId ? " is-selected" : ""}`}
                onClick={() => onSelectBlock(unit.blockId)}
              >
                <div className="galgame-localization-source">
                  <span className="galgame-localization-unit-type">
                    {translationTypeLabel(unit)}
                  </span>
                  <small>
                    #{String(index + 1).padStart(2, "0")} ·{" "}
                    {unit.blockId.slice(0, 8)}
                  </small>
                  <p>{unit.sourceText}</p>
                </div>
                <div className="galgame-localization-target">
                  <span className={`galgame-localization-status is-${status}`}>
                    {status === "translated" ? (
                      <CheckCircle2 aria-hidden />
                    ) : status === "stale" ? (
                      <AlertTriangle aria-hidden />
                    ) : null}
                    {STATUS_LABEL[status]}
                  </span>
                  <textarea
                    aria-label={`${translationTypeLabel(unit)}译文`}
                    value={entry?.text ?? ""}
                    placeholder="在这里输入对应译文…"
                    onFocus={() => onSelectBlock(unit.blockId)}
                    onChange={(event) =>
                      onDocument(
                        updateLocalizationEntry(
                          document,
                          targetLocale,
                          unit,
                          event.target.value,
                        ),
                      )
                    }
                  />
                </div>
              </article>
            );
          })
        ) : (
          <div className="galgame-localization-empty">
            <Languages aria-hidden />
            <strong>当前 Fragment 没有可翻译文本</strong>
            <p>
              对白、旁白、段落、浮动文字、系统消息、分支与结局标签会显示在这里。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
