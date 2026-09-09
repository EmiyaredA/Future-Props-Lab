import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { HistoryMark } from "./historyDiff";

export const historyDecorationKey = new PluginKey<DecorationSet>(
  "thought-history",
);
export const HistoryDecorations = Extension.create({
  name: "thoughtHistory",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: historyDecorationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previous) {
            const data = transaction.getMeta(historyDecorationKey) as
              { marks: HistoryMark[]; author: string } | undefined;
            if (!data)
              return transaction.docChanged ? DecorationSet.empty : previous;
            return DecorationSet.create(
              transaction.doc,
              data.marks
                .filter((mark) => mark.to <= transaction.doc.content.size)
                .map((mark, index) => {
                  const attrs = {
                    class: `thought-history-change is-${mark.kind}`,
                    "data-history-change": String(index),
                    "data-author": data.author,
                    title: `${data.author} · ${{ added: "新增", deleted: "删除", format: "格式修改" }[mark.kind]}`,
                  };
                  return mark.block
                    ? Decoration.node(mark.from, mark.to, attrs)
                    : Decoration.inline(mark.from, mark.to, attrs);
                }),
            );
          },
        },
        props: {
          decorations(state) {
            return historyDecorationKey.getState(state);
          },
        },
      }),
    ];
  },
});
