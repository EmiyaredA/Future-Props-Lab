import { useEffect, useState } from "react";
import type { SlideElement } from "../../types";

export type Formula = NonNullable<SlideElement["formula"]>;
export type FormulaDrawing = { svg: string; width: number; height: number };
type Result = { key: string; drawing?: FormulaDrawing; error?: string };

export function useFormulaPreview(
  formula: Formula | null,
  delay = 200,
  composing = false,
) {
  const key = formula ? JSON.stringify(formula) : "";
  const [result, setResult] = useState<Result>({ key: "" });
  useEffect(() => {
    if (!key || composing) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const value: Formula = JSON.parse(key);
        if (!value.latex.trim()) throw new Error("请输入公式，或选择一个模板");
        const { formulaSvg } = await import("../formulaSvg");
        const svg = await formulaSvg(value);
        const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
        const width = Number(xml.documentElement.getAttribute("width"));
        const height = Number(xml.documentElement.getAttribute("height"));
        if (![width, height].every((v) => Number.isFinite(v) && v > 0))
          throw new Error("公式没有有效绘制范围");
        if (!cancelled) setResult({ key, drawing: { svg, width, height } });
      } catch (error) {
        if (!cancelled)
          setResult({
            key,
            error:
              error instanceof Error ? error.message : "公式预览失败，请重试",
          });
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, delay, composing]);
  return key && !composing && result.key === key ? result : { key };
}

export const formulaImage = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
