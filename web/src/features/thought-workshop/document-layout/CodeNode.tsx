import CodeBlock from "@tiptap/extension-code-block";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createLowlight, common } from "lowlight";
import { CodeToolbar } from "./ContentChrome";
const highlighter = createLowlight(common);
function CodeView({ node, editor, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="document-code-block">
      <CodeToolbar
        source={node.textContent}
        language={node.attrs.language || ""}
      >
        {editor.isEditable ? (
          <input
            aria-label="代码语言"
            maxLength={100}
            value={node.attrs.language || ""}
            placeholder="纯文本"
            onChange={(e) =>
              updateAttributes({ language: e.target.value || null })
            }
          />
        ) : undefined}
      </CodeToolbar>
      <pre>
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}
export const DocumentCodeNode = CodeBlock.extend({
  addNodeView: () => ReactNodeViewRenderer(CodeView),
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (
                node.type.name !== "codeBlock" ||
                !node.attrs.language ||
                !highlighter.registered(node.attrs.language)
              )
                return;
              let offset = pos + 1;
              const walk = (
                child: {
                  type: string;
                  value?: string;
                  properties?: { className?: unknown };
                  children?: unknown[];
                },
                classes: string[] = [],
              ) => {
                if (child.type === "text") {
                  const end = offset + (child.value?.length ?? 0);
                  if (classes.length && end > offset)
                    decorations.push(
                      Decoration.inline(offset, end, {
                        class: classes.join(" "),
                      }),
                    );
                  offset = end;
                } else {
                  const own = Array.isArray(child.properties?.className)
                    ? child.properties.className.filter(
                        (v): v is string => typeof v === "string",
                      )
                    : [];
                  child.children?.forEach((c) =>
                    walk(c as Parameters<typeof walk>[0], [...classes, ...own]),
                  );
                }
              };
              try {
                walk(
                  highlighter.highlight(node.attrs.language, node.textContent),
                );
              } catch {
                /* Unknown or incomplete code remains plain text. */
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
