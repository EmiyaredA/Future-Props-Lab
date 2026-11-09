import * as Tooltip from "@radix-ui/react-tooltip";
import { type ComponentProps, type ReactNode } from "react";

export function ActionHint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="amadeus-action-tooltip"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ActionIcon({
  label,
  hint = label,
  className = "",
  ...props
}: ComponentProps<"button"> & { label: string; hint?: string }) {
  return (
    <ActionHint label={hint}>
      <button
        type="button"
        {...props}
        aria-label={label}
        className={`amadeus-action-icon ${className}`}
      />
    </ActionHint>
  );
}
