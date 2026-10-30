import { useId, useState } from "react";
import { ChevronDown, FileText, Type } from "lucide-react";

export function PresentationNotes({
  notes,
  readOnly,
  onChange,
  onRichEdit,
  rich = false,
}: {
  notes: string;
  readOnly: boolean;
  onChange: (notes: string) => void;
  onRichEdit?: () => void;
  rich?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`presentation-notes${open ? " expanded" : ""}`}>
      <div className="presentation-notes-header">
        <button
          className="presentation-notes-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <span className="presentation-notes-icon">
            <FileText size={16} />
          </span>
          <span className="presentation-notes-heading">
            <span>演示者备注</span>
            <small>
              {notes ? "本页已添加讲解内容" : "添加讲解内容，放映时可查看"}
            </small>
          </span>
          <ChevronDown className="presentation-notes-chevron" size={16} />
        </button>
        {open && onRichEdit && !readOnly && (
          <button className="presentation-notes-rich" onClick={onRichEdit}>
            <Type size={15} aria-hidden="true" />
            {rich ? "编辑富文本备注" : "富文本备注"}
          </button>
        )}
      </div>
      <div id={id} className="presentation-notes-content" hidden={!open}>
        {rich && (
          <p className="presentation-notes-hint">
            直接修改下方纯文本会移除备注格式；保留格式请使用“编辑富文本备注”。
          </p>
        )}
        <textarea
          aria-label="演示者备注"
          placeholder="在这里写下讲解思路、提示或补充说明…"
          maxLength={20000}
          readOnly={readOnly}
          value={notes}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </section>
  );
}
