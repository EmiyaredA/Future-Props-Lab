import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import "./editor-controls.css";

export function PetPicker({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: {
    value: string;
    label: string;
    disabled?: boolean;
    description?: string;
  }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = options.find((item) => item.value === value);
  return (
    <div className="dp-field">
      <span>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="dp-picker"
          disabled={disabled}
          aria-label={label}
          aria-description={selected?.description}
        >
          {selected?.label ?? "未设置"}
          <ChevronDown size={14} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="dp-menu"
            sideOffset={4}
            align="start"
            collisionPadding={12}
            aria-label={label}
          >
            <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
              {options.map((option) => (
                <DropdownMenu.RadioItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  title={option.description}
                  aria-description={option.description}
                >
                  <span className="dp-menu-indicator">
                    <DropdownMenu.ItemIndicator>
                      <Check size={14} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span>{option.label}</span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
