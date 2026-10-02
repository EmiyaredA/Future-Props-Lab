import {
  CalloutNode,
  DocumentReferenceNode,
} from "./knowledge-tools/ContentNodes";
import { CanvasNode } from "./diagrams/CanvasNode";
import { AttachmentNode } from "./AttachmentNode";
import type { AnyExtension } from "@tiptap/core";
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
import NodeRange from "@tiptap/extension-node-range";
import { ManagedImage, MermaidNode } from "./RichNodes";
import { createSlashCommand } from "./SlashCommand";
import type { InsertCallbacks } from "./blockCommands";

export function editorExtensions(
  onMath?: (latex: string, position: number, inline: boolean) => void,
  readOnly = false,
  insertCallbacks?: InsertCallbacks,
) {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      link: {
        openOnClick: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { tabindex: "0" },
      },
      dropcursor: { color: "#f08b62", width: 3 },
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
    CanvasNode,
    CalloutNode,
    DocumentReferenceNode,
    Placeholder.configure({ placeholder: "从一个想法开始…" }),
  ];
  if (!readOnly) extensions.push(NodeRange.configure({ key: "Mod" }));
  if (!readOnly && insertCallbacks)
    extensions.push(createSlashCommand(insertCallbacks));
  return extensions;
}
