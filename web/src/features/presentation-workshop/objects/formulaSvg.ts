import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js";
import type { SlideElement } from "../types";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

export async function formulaSvg(
  formula: NonNullable<SlideElement["formula"]>,
): Promise<string> {
  const document = mathjax.document("", {
    InputJax: new TeX({
      packages: [
        "base",
        "ams",
        "newcommand",
        "configmacros",
        "cancel",
        "mathtools",
      ],
    }),
    OutputJax: new SVG({ fontCache: "local" }),
  });
  const node = await mathjax.handleRetriesFor(() =>
    document.convert(formula.latex, { display: true }),
  );
  const xml = new DOMParser().parseFromString(
    adaptor.outerHTML(node),
    "text/html",
  );
  const svg = xml.querySelector("svg");
  if (!svg || svg.querySelector('[data-mml-node="merror"]'))
    throw new Error("公式无法转换，请检查 LaTeX 语法");
  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    viewBox.some((v) => !Number.isFinite(v))
  )
    throw new Error("公式没有有效绘制范围");
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith("data-") ||
        ["role", "focusable", "aria-hidden", "style", "font-size"].includes(
          attribute.name,
        )
      )
        element.removeAttribute(attribute.name);
      else if (attribute.value === "currentColor")
        element.setAttribute(attribute.name, formula.color);
    }
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute(
    "width",
    String(Math.max(1, (viewBox[2] / 1000) * formula.size)),
  );
  svg.setAttribute(
    "height",
    String(Math.max(1, (viewBox[3] / 1000) * formula.size)),
  );
  svg.setAttribute("color", formula.color);
  return new XMLSerializer().serializeToString(svg);
}
