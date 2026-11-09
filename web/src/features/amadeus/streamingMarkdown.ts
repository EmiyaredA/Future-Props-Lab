// Adapted from Happier 2aeb139d, components/markdown/streaming.
// MIT notice in /brand/amadeus/HAPPIER-LICENSE.txt.
import remend, { type RemendOptions } from "remend";

const options = {
  inlineKatex: false,
  katex: true,
  linkMode: "protocol",
  htmlTags: false,
} satisfies RemendOptions;

export function prepareStreamingMarkdown(text: string) {
  const repaired = remend(text, options);
  return repaired.endsWith("](streamdown:incomplete-link)")
    ? remend(repaired, { ...options, links: false, images: false })
    : repaired;
}
