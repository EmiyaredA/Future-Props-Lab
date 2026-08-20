import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, UserRound } from "lucide-react";
import type {
  GalgameStoryBlock,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import type { GalgameStoryDialogueBlock } from "@features/galgame-workshop/editor/dialogue";
import { characterStageSettings } from "@features/galgame-workshop/editor/characterStageSettings";
import { nearestCharacterPositionId } from "@features/galgame-workshop/editor/characterPresentation";
import type { StageActor } from "@features/galgame-workshop/editor/stage";

const CHARACTER_DISTANCE_OPTIONS = [
  { id: "far", label: "远" },
  { id: "medium", label: "中" },
  { id: "near", label: "近" },
] as const;

export function DialoguePresentationPicker({
  block,
  document,
  effectiveActor,
  onBlock,
}: {
  block: GalgameStoryDialogueBlock;
  document: GalgameStoryProject;
  effectiveActor?: StageActor;
  onBlock: (block: GalgameStoryBlock) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const popoverId = useId();
  const [popoverPosition, setPopoverPosition] = useState({
    left: 8,
    top: 8,
    maxHeight: 320,
  });
  const stageSettings = characterStageSettings(document, block.characterId);
  const portrait = block.portrait;
  const distance = portrait?.distance ?? effectiveActor?.distance ?? "medium";
  const distanceLabel =
    CHARACTER_DISTANCE_OPTIONS.find((option) => option.id === distance)
      ?.label ?? "中";
  const positionId =
    portrait?.positionId ??
    effectiveActor?.positionId ??
    (effectiveActor
      ? nearestCharacterPositionId(stageSettings, effectiveActor.transform.x)
      : stageSettings.defaultPositionId);
  const position =
    stageSettings.positionPresets.find((preset) => preset.id === positionId) ??
    stageSettings.positionPresets[0];
  const avatarOnly = portrait?.mode === "dialogueAvatar";
  const themeColor =
    (document.characters ?? []).find(
      (character) => character.id === block.characterId,
    )?.themeColor ?? "#E75B55";

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popover = popoverRef.current;
    const width = Math.min(popover?.offsetWidth ?? 236, window.innerWidth - 16);
    const height = Math.min(
      popover?.offsetHeight ?? 320,
      Math.max(180, window.innerHeight - 16),
    );
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const top =
      spaceBelow >= height || spaceBelow >= spaceAbove
        ? rect.bottom + 6
        : rect.top - height - 6;
    setPopoverPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
      maxHeight: Math.max(180, window.innerHeight - 16),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !popoverRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeWithKeyboard);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const frame = requestAnimationFrame(updatePopoverPosition);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  const updatePresentation = (
    next: Partial<NonNullable<GalgameStoryDialogueBlock["portrait"]>>,
  ) => {
    onBlock({
      ...block,
      portrait: {
        mode: "stage",
        visible: true,
        keepAfter: true,
        transition: { durationMs: 240, fade: true },
        ...portrait,
        ...next,
        transform: null,
      },
    });
  };

  return (
    <>
      <div className="galgame-dialogue-presentation-picker">
        <button
          ref={triggerRef}
          type="button"
          className="galgame-dialogue-presentation-trigger"
          aria-label={`人物呈现：${avatarOnly ? "仅对白头像" : `${distanceLabel} · ${position?.name ?? "默认"}`}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((current) => !current);
          }}
        >
          <UserRound aria-hidden />
          <span>
            {avatarOnly
              ? "仅头像"
              : `${distanceLabel} · ${position?.name ?? "默认"}`}
          </span>
          <ChevronDown aria-hidden />
        </button>
      </div>
      {open
        ? createPortal(
            <section
              id={popoverId}
              ref={popoverRef}
              className="galgame-dialogue-presentation-popover"
              role="dialog"
              aria-label="人物呈现"
              style={
                {
                  left: popoverPosition.left,
                  top: popoverPosition.top,
                  maxHeight: popoverPosition.maxHeight,
                  "--dialogue-theme": themeColor,
                } as CSSProperties
              }
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <strong>{block.characterId ? "人物呈现" : "角色呈现"}</strong>
                <small>站位与尺寸来自角色资产</small>
              </header>
              <button
                type="button"
                className={avatarOnly ? "active" : ""}
                onClick={() => {
                  updatePresentation({
                    mode: "dialogueAvatar",
                    visible: true,
                    keepAfter: false,
                  });
                  setOpen(false);
                }}
              >
                <span>仅对白头像</span>
                {avatarOnly ? <Check aria-hidden /> : null}
              </button>
              <div className="galgame-dialogue-presentation-section">
                <small>距离</small>
                <div className="galgame-dialogue-distance-options">
                  {CHARACTER_DISTANCE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={
                        !avatarOnly && distance === option.id ? "active" : ""
                      }
                      onClick={() =>
                        updatePresentation({
                          mode: "stage",
                          distance: option.id,
                          positionId,
                        })
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="galgame-dialogue-presentation-section">
                <small>{distanceLabel}景位置</small>
                <div className="galgame-dialogue-position-options">
                  {stageSettings.positionPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={
                        !avatarOnly && positionId === preset.id ? "active" : ""
                      }
                      onClick={() => {
                        updatePresentation({
                          mode: "stage",
                          distance,
                          positionId: preset.id,
                        });
                        setOpen(false);
                      }}
                    >
                      <span>{preset.name}</span>
                      {!avatarOnly && positionId === preset.id ? (
                        <Check aria-hidden />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </section>,
            globalThis.document.body,
          )
        : null}
    </>
  );
}

/**
 * Keep the command palette legible at a glance. The old fallback made almost
 * every Block look like a text command, which was especially noisy in the
 * four insertion columns. This map is deliberately exhaustive so a new Block
 * kind cannot silently fall back to a generic glyph.
 */
