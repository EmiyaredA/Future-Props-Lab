import { AlignLeft, AlignCenter, AlignRight, Bold } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { Numeric, Color } from "./StyleFields";
import type { Slot } from "./model";
export function TemplateSlotEditor({
  name,
  slot,
  onChange,
  width,
  height,
}: {
  name: string;
  slot: Slot;
  onChange: (s: Slot) => void;
  width: number;
  height: number;
}) {
  const patch = (value: Partial<Slot>) => onChange({ ...slot, ...value });
  return (
    <div className="master-slot-editor">
      <label className="master-field master-inline-field">
        <span>字体</span>
        <CustomSelect
          ariaLabel={`${name}字体`}
          value={slot.style.font}
          options={[
            { value: "Microsoft YaHei", label: "微软雅黑" },
            { value: "Arial", label: "Arial" },
            { value: "Consolas", label: "Consolas" },
          ]}
          onChange={(font) =>
            patch({
              style: { ...slot.style, font: font as Slot["style"]["font"] },
            })
          }
        />
      </label>
      <div className="master-type-row">
        <Numeric
          label={`${name}字号`}
          caption="字号"
          value={slot.style.size}
          min={6}
          max={240}
          onChange={(size) => patch({ style: { ...slot.style, size } })}
        />
        <button
          className="master-toggle"
          aria-label={`${name}加粗`}
          aria-pressed={slot.style.bold}
          onClick={() =>
            patch({ style: { ...slot.style, bold: !slot.style.bold } })
          }
        >
          <Bold size={18} />
        </button>
      </div>
      <Color
        label={`${name}颜色`}
        caption="颜色"
        value={slot.style.color}
        onChange={(color) => patch({ style: { ...slot.style, color } })}
      />
      <div className="master-inline-field">
        <span>对齐</span>
        <div
          className="master-segmented"
          role="group"
          aria-label={`${name}对齐`}
        >
          {(
            [
              { value: "left", label: "左对齐", Icon: AlignLeft },
              { value: "center", label: "居中", Icon: AlignCenter },
              { value: "right", label: "右对齐", Icon: AlignRight },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              aria-label={`${name}${label}`}
              aria-pressed={slot.style.align === value}
              onClick={() => patch({ style: { ...slot.style, align: value } })}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="master-geometry-label">
        位置与大小 <span>px</span>
      </div>
      <div className="master-coordinates">
        <Numeric
          label={`${name} X`}
          caption="X"
          value={slot.x}
          max={width - slot.width}
          onChange={(x) => patch({ x })}
        />
        <Numeric
          label={`${name} Y`}
          caption="Y"
          value={slot.y}
          max={height - slot.height}
          onChange={(y) => patch({ y })}
        />
        <Numeric
          label={`${name}宽度`}
          caption="W"
          value={slot.width}
          min={1}
          max={width - slot.x}
          onChange={(width) => patch({ width })}
        />
        <Numeric
          label={`${name}高度`}
          caption="H"
          value={slot.height}
          min={1}
          max={height - slot.y}
          onChange={(height) => patch({ height })}
        />
      </div>
      <label className="master-check">
        <input
          type="checkbox"
          checked={slot.visible !== false}
          onChange={(e) => patch({ visible: e.target.checked })}
        />
        在当前页型显示{name}
      </label>
    </div>
  );
}
