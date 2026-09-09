export async function renderDiagram(source: string, id: string) {
  if (source.length > 50000) throw new Error("图表源码过长");
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    maxTextSize: 50000,
    suppressErrorRendering: true,
  });
  const { svg } = await mermaid.render(id, source);
  // Mermaid strict mode sanitizes its SVG. It must never bind click handlers.
  return svg;
}
