import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, X } from "lucide-react";
import type { ReactNode } from "react";
export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="l2-field">
      <span>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={disabled}
          className="l2-choice"
          aria-label={label}
        >
          {options.find((o) => o.value === value)?.label ?? "未选择"}
          <ChevronDown size={14} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="l2-menu" sideOffset={5}>
            {options.map((o) => (
              <DropdownMenu.Item
                key={o.value}
                onSelect={() => onChange(o.value)}
              >
                {o.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </label>
  );
}
export function Numeric({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="l2-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== "" && Number.isFinite(e.target.valueAsNumber))
            onChange(
              Math.max(
                min ?? -100000,
                Math.min(max ?? 100000, e.target.valueAsNumber),
              ),
            );
        }}
      />
    </label>
  );
}
export function Modal({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="l2-overlay" />
        <Dialog.Content className="l2-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
          <Dialog.Close className="l2-dialog-close" aria-label="关闭">
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
