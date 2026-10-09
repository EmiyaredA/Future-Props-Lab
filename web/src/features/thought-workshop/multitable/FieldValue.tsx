import type { CSSProperties } from "react";
import {
  CalendarDays,
  CheckSquare,
  CircleDot,
  File,
  Hash,
  Link,
  ListChecks,
  StickyNote,
  Type,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { Field } from "./api";
import { formatFieldValue } from "./formatting";
import type { People } from "./formatting";

const fieldIcon: Record<Field["type"], LucideIcon> = {
  text: Type,
  number: Hash,
  single: CircleDot,
  multi: ListChecks,
  date: CalendarDays,
  checkbox: CheckSquare,
  url: Link,
  attachment: File,
  note: StickyNote,
  person: UserRound,
};
export function FieldIcon({ type }: { type: Field["type"] }) {
  const Icon = fieldIcon[type];
  return <Icon size={14} aria-hidden="true" />;
}
export function FieldValue({
  field,
  value,
  people = {},
}: {
  field: Field;
  value: unknown;
  people?: People;
}) {
  if (field.type === "single" || field.type === "multi") {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return (
      <span className="multitable-tags">
        {values.map((id) => {
          const option = field.options?.find((o) => o.id === id);
          return option ? (
            <span
              key={String(id)}
              className="multitable-tag"
              style={{ "--option-color": option.color } as CSSProperties}
            >
              <i aria-hidden="true" />
              {option.label}
            </span>
          ) : null;
        })}
        {!values.length && <span className="multitable-empty-value">—</span>}
      </span>
    );
  }
  return (
    <span className={`multitable-value is-${field.type}`}>
      {formatFieldValue(field, value, people) || (
        <span className="multitable-empty-value">—</span>
      )}
    </span>
  );
}
