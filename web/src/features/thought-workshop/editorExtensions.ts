import { AttachmentNode } from "./AttachmentNode";
import StarterKit from "@tiptap/starter-kit";
import {
  TextStyle,
  Color,
  FontSize,
  BackgroundColor,
} from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import {
  Details,
  DetailsSummary,
  DetailsContent,
} from "@tiptap/extension-details";
import Mathematics from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import { ManagedImage, MermaidNode } from "./RichNodes";

export function editorExtensions(
  onMath?: (latex: string, position: number, inline: boolean) => void,
  readOnly = false,
) {
  return [
    StarterKit.configure({
      link: { openOnClick: readOnly, protocols: ["http", "https", "mailto"] },
    }),
    TextStyle,
    Color,
    FontSize,
    BackgroundColor,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    Mathematics.configure({
      katexOptions: { throwOnError: false, trust: false },
      inlineOptions: {
        onClick: (node, pos) => onMath?.(node.attrs.latex, pos, true),
      },
      blockOptions: {
        onClick: (node, pos) => onMath?.(node.attrs.latex, pos, false),
      },
    }),
    ManagedImage,
    AttachmentNode,
    MermaidNode,
    Placeholder.configure({ placeholder: "从一个想法开始…" }),
  ];
}
