import type { Paragraph } from "./types";

export type ListType = "none" | "bullet" | "ordered";
export const listOptions = [
  { value: "none", label: "无列表" },
  { value: "bullet", label: "项目符号" },
  { value: "ordered", label: "编号列表" },
];

export function paragraphListType(
  paragraph: Pick<Paragraph, "bullet" | "numbered">,
): ListType {
  return paragraph.numbered ? "ordered" : paragraph.bullet ? "bullet" : "none";
}

export function listAttributes(type: ListType) {
  return { bullet: type === "bullet", numbered: type === "ordered" };
}

export function paragraphMarkers(paragraphs: Paragraph[]): string[] {
  let number = 0;
  return paragraphs.map((paragraph) => {
    number = paragraph.numbered ? number + 1 : 0;
    return paragraph.numbered ? `${number}.` : paragraph.bullet ? "•" : "";
  });
}
