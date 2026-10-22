import type { ButtonHTMLAttributes, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";

export function Button({
  children,
  variant = "",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button
      type={type}
      className={`btn button ${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <div className="interview-assistant ia-dialog-layer">
          <Dialog.Overlay className="modal-backdrop" />
          <Dialog.Content
            className={`modal ${wide ? "wide" : ""}`}
            aria-describedby={undefined}
          >
            <header className="modal-header">
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button className="icon-button" aria-label="关闭对话框">
                  <X size={20} />
                </Button>
              </Dialog.Close>
            </header>
            <div className="modal-body">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="ia-selector">
      <span className="field-label">{label}</span>
      <CustomSelect
        ariaLabel={label}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
