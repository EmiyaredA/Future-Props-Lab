import { useState } from "react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { NumberField } from "../PresentationNumberField";
import {
  mergeCells,
  resizeTable,
  splitCell,
  type TableData,
} from "./tableEditing";

export function TableEditor({
  data,
  change,
}: {
  data: TableData;
  change: (data: TableData) => void;
}) {
  const [start, setStart] = useState<[number, number]>([0, 0]);
  const [end, setEnd] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState("");
  const selected = data.rows[start[0]]?.[start[1]];
  const patchCell = (patch: Partial<TableData["rows"][number][number]>) =>
    change({
      ...data,
      rows: data.rows.map((row, r) =>
        row.map((cell, c) =>
          r === start[0] && c === start[1] ? { ...cell, ...patch } : cell,
        ),
      ),
    });
  const resize = (rows: number, columns: number) => {
    change(resizeTable(data, rows, columns));
    setStart([0, 0]);
    setEnd([0, 0]);
  };
  return (
    <>
      <div className="presentation-object-actions">
        <button
          className="btn"
          disabled={data.rows.length >= 100}
          onClick={() =>
            resize(data.rows.length + 1, data.column_widths.length)
          }
        >
          添加行
        </button>
        <button
          className="btn"
          disabled={data.rows.length <= 1}
          onClick={() =>
            resize(data.rows.length - 1, data.column_widths.length)
          }
        >
          删除末行
        </button>
        <button
          className="btn"
          disabled={data.column_widths.length >= 30}
          onClick={() =>
            resize(data.rows.length, data.column_widths.length + 1)
          }
        >
          添加列
        </button>
        <button
          className="btn"
          disabled={data.column_widths.length <= 1}
          onClick={() =>
            resize(data.rows.length, data.column_widths.length - 1)
          }
        >
          删除末列
        </button>
        <button
          className="btn"
          onClick={() => {
            try {
              change(mergeCells(data, start, end));
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          合并选区
        </button>
        <button
          className="btn"
          disabled={
            !selected ||
            selected.covered ||
            (selected.row_span === 1 && selected.col_span === 1)
          }
          onClick={() => change(splitCell(data, ...start))}
        >
          拆分单元格
        </button>
      </div>
      <p className="muted">
        点击单元格选中，按住 Shift
        点击另一单元格选择合并范围。增删行列会拆分现有合并。
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="presentation-data-grid">
        <table>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                {row.map((item, c) => (
                  <td
                    key={c}
                    data-selected={
                      r >= Math.min(start[0], end[0]) &&
                      r <= Math.max(start[0], end[0]) &&
                      c >= Math.min(start[1], end[1]) &&
                      c <= Math.max(start[1], end[1])
                    }
                  >
                    <textarea
                      aria-label={`第 ${r + 1} 行第 ${c + 1} 列`}
                      value={item.text}
                      disabled={item.covered}
                      placeholder={item.covered ? "已合并" : ""}
                      style={{
                        background: item.fill,
                        color: item.color,
                        fontWeight: item.bold ? 700 : 400,
                        textAlign: item.align,
                      }}
                      onClick={(event) => {
                        if (event.shiftKey) setEnd([r, c]);
                        else {
                          setStart([r, c]);
                          setEnd([r, c]);
                        }
                      }}
                      onFocus={() => {
                        if (
                          start[0] >= data.rows.length ||
                          start[1] >= data.column_widths.length
                        ) {
                          setStart([r, c]);
                          setEnd([r, c]);
                        }
                      }}
                      onChange={(event) =>
                        change({
                          ...data,
                          rows: data.rows.map((row, rr) =>
                            row.map((cell, cc) =>
                              rr === r && cc === c
                                ? { ...cell, text: event.target.value }
                                : cell,
                            ),
                          ),
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div
          className="presentation-object-actions"
          role="group"
          aria-label="单元格样式"
        >
          {(["bold", "italic", "underline", "strike"] as const).map(
            (key, i) => (
              <button
                key={key}
                className="btn"
                aria-pressed={selected[key]}
                onClick={() => patchCell({ [key]: !selected[key] })}
              >
                {["加粗", "斜体", "下划线", "删除线"][i]}
              </button>
            ),
          )}
          <CustomColorPicker
            ariaLabel="单元格背景"
            value={selected.fill}
            onChange={(fill) => patchCell({ fill })}
          />
          <CustomColorPicker
            ariaLabel="单元格文字颜色"
            value={selected.color}
            onChange={(color) => patchCell({ color })}
          />
          <CustomSelect
            ariaLabel="单元格对齐"
            value={selected.align}
            options={[
              { value: "left", label: "左对齐" },
              { value: "center", label: "居中" },
              { value: "right", label: "右对齐" },
            ]}
            onChange={(align) =>
              patchCell({ align: align as typeof selected.align })
            }
          />
          <NumberField
            label="表格字号"
            value={data.font_size}
            min={6}
            max={240}
            onChange={(font_size) => change({ ...data, font_size })}
          />
          <NumberField
            label="选中列相对宽度"
            value={data.column_widths[start[1]]}
            min={0.1}
            max={100}
            step={0.1}
            onChange={(width) =>
              change({
                ...data,
                column_widths: data.column_widths.map((v, i) =>
                  i === start[1] ? width : v,
                ),
              })
            }
          />
          <CustomColorPicker
            ariaLabel="表格边框颜色"
            value={data.border_color}
            onChange={(border_color) => change({ ...data, border_color })}
          />
          <button
            className="btn"
            onClick={() =>
              change({
                ...data,
                rows: data.rows.map((row, r) =>
                  row.map((cell) => ({
                    ...cell,
                    fill: r === 0 ? "#5474E5" : r % 2 ? "#EEF2FF" : "#FFFFFF",
                    color: r === 0 ? "#FFFFFF" : "#17334A",
                    bold: r === 0,
                  })),
                ),
              })
            }
          >
            应用蓝青表格主题
          </button>
        </div>
      )}
    </>
  );
}
