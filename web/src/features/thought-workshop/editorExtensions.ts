import {
  CalloutNode,
  DocumentReferenceNode,
} from "./knowledge-tools/ContentNodes";
import { MultitableViewNode } from "./multitable/EmbedNode";
import { CanvasNode } from "./diagrams/CanvasNode";
import { AttachmentNode } from "./AttachmentNode";
import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DocumentCodeNode } from "./document-layout/CodeNode";
import {
  DocumentCardNode,
  CardGridNode,
  DocumentDirectoryNode,
} from "./document-layout/NavigationNodes";
import {
  TextStyle,
  Color,
  FontSize,
  BackgroundColor,
} from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import {
  TABLE_COLUMN_MIN_WIDTH,
  DocumentTableView,
  documentTableColumnResize,
} from "./tableColumnResize";
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
      codeBlock: false,
      link: {
        openOnClick: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: { tabindex: "0" },
      },
      dropcursor: { color: "#f08b62", width: 3 },
    }),
    TextStyle,
    DocumentCodeNode,
    Color,
    FontSize,
    BackgroundColor,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    documentTableColumnResize,
    TableKit.configure({
      table: {
        resizable: false,
        cellMinWidth: TABLE_COLUMN_MIN_WIDTH,
        View: DocumentTableView,
      },
    }),
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
    MultitableViewNode,
    CalloutNode,
    DocumentReferenceNode,
    DocumentCardNode,
    CardGridNode,
    DocumentDirectoryNode,
    Placeholder.configure({ placeholder: "从一个想法开始…" }),
  ];
  if (!readOnly) extensions.push(NodeRange.configure({ key: "Mod" }));
  if (!readOnly && insertCallbacks)
    extensions.push(createSlashCommand(insertCallbacks));
  return extensions;
}
