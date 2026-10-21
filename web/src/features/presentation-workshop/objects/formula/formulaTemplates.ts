export const cosineFormula = String.raw`\cos(\mathbf{q},\mathbf{d})=\frac{\mathbf{q}\cdot\mathbf{d}}{\lVert\mathbf{q}\rVert\,\lVert\mathbf{d}\rVert}`;

export const formulaTemplates = [
  {
    label: "分数",
    sample: String.raw`\frac{a}{b}`,
    wrap: (s: string) => String.raw`\frac{${s || "a"}}{b}`,
  },
  {
    label: "上下标",
    sample: "x_i^{n}",
    wrap: (s: string) => `{${s || "x"}}_{i}^{n}`,
  },
  {
    label: "根号",
    sample: String.raw`\sqrt{x}`,
    wrap: (s: string) => String.raw`\sqrt{${s || "x"}}`,
  },
  {
    label: "求和",
    sample: String.raw`\sum_{i=1}^{n}x_i`,
    wrap: (s: string) => String.raw`\sum_{i=1}^{n} ${s || "x_i"}`,
  },
  {
    label: "积分",
    sample: String.raw`\int_a^b f(x)\,dx`,
    wrap: (s: string) => String.raw`\int_a^b ${s || "f(x)"}\,dx`,
  },
  {
    label: "矩阵",
    sample: String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
    wrap: (s: string) =>
      String.raw`\begin{bmatrix}${s || "a"}&b\\c&d\end{bmatrix}`,
  },
];

export function insertFormulaTemplate(
  source: string,
  start: number,
  end: number,
  wrap: (selection: string) => string,
) {
  const inserted = wrap(source.slice(start, end));
  return {
    latex: source.slice(0, start) + inserted + source.slice(end),
    start,
    end: start + inserted.length,
  };
}
