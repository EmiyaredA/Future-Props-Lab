import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import type { SlideElement } from "../types";
type Chart = NonNullable<SlideElement["chart"]>;
export function ChartEditor({
  data,
  change,
}: {
  data: Chart;
  change: (data: Chart) => void;
}) {
  return (
    <>
      <div className="presentation-object-actions">
        <CustomSelect
          ariaLabel="图表类型"
          value={data.type}
          options={[
            "column",
            "bar",
            "line",
            "area",
            "scatter",
            "pie",
            "ring",
            "radar",
          ].map((value, i) => ({
            value,
            label: [
              "柱状图",
              "条形图",
              "折线图",
              "面积图",
              "散点图",
              "饼图",
              "环形图",
              "雷达图",
            ][i],
          }))}
          onChange={(value) =>
            change({
              ...data,
              type: value as Chart["type"],
              ...(value === "scatter"
                ? {
                    categories: data.categories.map((c, i) =>
                      Number.isFinite(Number(c)) ? c : String(i + 1),
                    ),
                  }
                : {}),
            })
          }
        />
        <button
          className="btn"
          disabled={data.categories.length >= 200}
          onClick={() =>
            change({
              ...data,
              categories: [
                ...data.categories,
                data.type === "scatter"
                  ? String(data.categories.length + 1)
                  : "新分类",
              ],
              series: data.series.map((s) => ({
                ...s,
                values: [...s.values, 0],
              })),
            })
          }
        >
          添加分类
        </button>
        <button
          className="btn"
          disabled={data.series.length >= 20}
          onClick={() =>
            change({
              ...data,
              series: [
                ...data.series,
                {
                  name: `系列 ${data.series.length + 1}`,
                  values: data.categories.map(() => 0),
                },
              ],
            })
          }
        >
          添加系列
        </button>
        <button
          className="btn"
          aria-pressed={data.stacked}
          disabled={!["column", "bar", "line", "area"].includes(data.type)}
          onClick={() => change({ ...data, stacked: !data.stacked })}
        >
          堆积
        </button>
        <button
          className="btn"
          aria-pressed={data.smooth}
          disabled={!["line", "area"].includes(data.type)}
          onClick={() => change({ ...data, smooth: !data.smooth })}
        >
          平滑曲线
        </button>
      </div>
      <div className="presentation-data-grid">
        <table>
          <thead>
            <tr>
              <th>{data.type === "scatter" ? "X 坐标" : "分类"}</th>
              {data.series.map((s, i) => (
                <th key={i}>
                  <div className="presentation-chart-series-heading">
                    <input
                      aria-label={`系列 ${i + 1} 名称`}
                      value={s.name}
                      maxLength={120}
                      onChange={(e) =>
                        change({
                          ...data,
                          series: data.series.map((item, j) =>
                            i === j ? { ...item, name: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <button
                      className="btn presentation-data-remove"
                      disabled={data.series.length <= 1}
                      aria-label={`删除系列 ${i + 1}`}
                      onClick={() =>
                        change({
                          ...data,
                          series: data.series.filter((_, j) => j !== i),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
              <th className="presentation-data-delete" />
            </tr>
          </thead>
          <tbody>
            {data.categories.map((category, r) => (
              <tr key={r}>
                <td>
                  <input
                    aria-label={`分类 ${r + 1}`}
                    value={category}
                    maxLength={200}
                    onChange={(e) =>
                      change({
                        ...data,
                        categories: data.categories.map((c, i) =>
                          i === r ? e.target.value : c,
                        ),
                      })
                    }
                  />
                </td>
                {data.series.map((s, c) => (
                  <td key={c}>
                    <input
                      aria-label={`系列 ${c + 1} 数据 ${r + 1}`}
                      type="number"
                      step="any"
                      value={s.values[r]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v))
                          change({
                            ...data,
                            series: data.series.map((item, i) =>
                              i === c
                                ? {
                                    ...item,
                                    values: item.values.map((x, j) =>
                                      j === r ? v : x,
                                    ),
                                  }
                                : item,
                            ),
                          });
                      }}
                    />
                  </td>
                ))}
                <td className="presentation-data-delete">
                  <button
                    className="btn presentation-data-remove"
                    disabled={data.categories.length <= 1}
                    aria-label={`删除分类 ${r + 1}`}
                    onClick={() =>
                      change({
                        ...data,
                        categories: data.categories.filter((_, i) => i !== r),
                        series: data.series.map((s) => ({
                          ...s,
                          values: s.values.filter((_, i) => i !== r),
                        })),
                      })
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="presentation-object-actions">
        {data.colors.map((color, i) => (
          <CustomColorPicker
            key={i}
            compact
            ariaLabel={`图表主题色 ${i + 1}`}
            value={color}
            onChange={(value) =>
              change({
                ...data,
                colors: data.colors.map((c, j) => (j === i ? value : c)),
              })
            }
          />
        ))}
        <CustomColorPicker
          ariaLabel="图表坐标轴颜色"
          value={data.axis_color}
          onChange={(axis_color) => change({ ...data, axis_color })}
        />
        <CustomColorPicker
          ariaLabel="图表网格颜色"
          value={data.grid_color}
          onChange={(grid_color) => change({ ...data, grid_color })}
        />
      </div>
    </>
  );
}
