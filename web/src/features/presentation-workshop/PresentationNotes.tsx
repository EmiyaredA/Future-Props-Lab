import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export function PresentationNotes({ notes, readOnly, onChange }: { notes: string; readOnly: boolean; onChange: (notes: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className={`presentation-notes${open ? " expanded" : ""}`}>
    <button className="presentation-notes-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <ChevronDown size={15} /><span>演示者备注</span><small>{notes ? "已添加备注" : "点击添加演示者备注…"}</small>
    </button>
    <textarea id={id} hidden={!open} aria-label="演示者备注" placeholder="点击添加演示者备注…" maxLength={20000} readOnly={readOnly} value={notes} onChange={(event) => onChange(event.target.value)} />
  </section>;
}
