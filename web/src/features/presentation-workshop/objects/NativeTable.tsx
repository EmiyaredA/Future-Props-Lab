import type { SlideElement } from "../types";

export function NativeTable({ element }: { element: SlideElement }) {
  const table = element.table;
  if (!table) return null;
  const total = table.column_widths.reduce((a, b) => a + b, 0);
  return (
    <table
      className="presentation-native-table"
      style={{
        width: "100%",
        height: "100%",
        tableLayout: "fixed",
        borderCollapse: "collapse",
        fontSize: table.font_size,
        opacity: element.opacity,
      }}
    >
      <colgroup>
        {table.column_widths.map((width, i) => (
          <col key={i} style={{ width: `${(width / total) * 100}%` }} />
        ))}
      </colgroup>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              cell.covered ? null : (
                <td
                  key={c}
                  rowSpan={cell.row_span}
                  colSpan={cell.col_span}
                  style={{
                    padding: "6px 8px",
                    overflowWrap: "anywhere",
                    background: cell.fill,
                    color: cell.color,
                    textAlign: cell.align,
                    whiteSpace: "pre-wrap",
                    fontWeight: cell.bold ? 700 : 400,
                    fontStyle: cell.italic ? "italic" : "normal",
                    textDecoration: [
                      cell.underline ? "underline" : "",
                      cell.strike ? "line-through" : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                    border: `${table.border_width}px solid ${table.border_color}`,
                  }}
                >
                  {cell.text}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
