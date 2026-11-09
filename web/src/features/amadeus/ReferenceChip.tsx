import * as Tooltip from "@radix-ui/react-tooltip";
import { Crosshair, Link2, X } from "lucide-react";
import type { Reference } from "./protocol";

export function ReferenceChip({
  reference,
  onOpen,
  onRemove,
}: {
  reference: Reference;
  onOpen: (reference: Reference) => void;
  onRemove?: () => void;
}) {
  const Icon = reference.target ? Crosshair : Link2;
  return (
    <span className="amadeus-ref">
      <Tooltip.Provider delayDuration={250} disableHoverableContent>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              className="amadeus-ref-content"
              aria-label={
                reference.target
                  ? `定位：${reference.name}`
                  : `查看引用：${reference.name}`
              }
              onClick={() => onOpen(reference)}
            >
              <Icon size={13} aria-hidden="true" />
              <span>{reference.name}</span>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              align="start"
              sideOffset={7}
              collisionPadding={8}
              className="amadeus-ref-tooltip"
            >
              <strong>{reference.name}</strong>
              <span>
                {reference.application}
                {reference.value ? ` · ${reference.value}` : ""}
              </span>
              {reference.target?.unsaved && <span>未保存草稿</span>}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      {onRemove && (
        <button
          type="button"
          className="amadeus-ref-remove"
          aria-label={`移除引用：${reference.name}`}
          title="移除引用"
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
