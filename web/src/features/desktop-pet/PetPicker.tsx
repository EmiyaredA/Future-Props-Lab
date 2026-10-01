import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";

export function PetPicker({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="dp-field">
      <span>{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          className="dp-picker"
          disabled={disabled}
          aria-label={label}
        >
          {options.find((item) => item.value === value)?.label ?? "未设置"}
          <ChevronDown size={14} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dp-menu" sideOffset={4}>
            {options.map((option) => (
              <DropdownMenu.Item
                key={option.value}
                onSelect={() => onChange(option.value)}
              >
                {option.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </label>
  );
}
