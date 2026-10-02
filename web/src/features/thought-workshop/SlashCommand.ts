import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { ComponentProps } from "react";
import Suggestion, { type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { BlockInsertMenu, type BlockInsertMenuHandle } from "./BlockInsertMenu";
import {
  INSERT_COMMANDS,
  runInsertCommand,
  type InsertCallbacks,
  type InsertCommand,
} from "./blockCommands";

const slashCommandKey = new PluginKey("thoughtSlashCommand");

export function createSlashCommand(callbacks: InsertCallbacks) {
  return Extension.create({
    name: "thoughtSlashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<InsertCommand, InsertCommand>({
          editor: this.editor,
          pluginKey: slashCommandKey,
          char: "/",
          startOfLine: true,
          allowedPrefixes: null,
          items: ({ query }) => {
            const needle = query.trim().toLowerCase();
            return INSERT_COMMANDS.filter((item) =>
              `${item.label} ${item.description} ${item.keywords}`
                .toLowerCase()
                .includes(needle),
            );
          },
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            return (
              $from.parent.type.name === "paragraph" &&
              range.from === $from.start()
            );
          },
          command: ({ editor, range, props }) => {
            runInsertCommand(editor, props.key, callbacks, range.from, range);
          },
          render: () => {
            let component: ReactRenderer<
              BlockInsertMenuHandle,
              ComponentProps<typeof BlockInsertMenu>
            > | null = null;
            let unmount: (() => void) | null = null;
            return {
              onStart: (props) => {
                const renderer = new ReactRenderer<
                  BlockInsertMenuHandle,
                  ComponentProps<typeof BlockInsertMenu>
                >(BlockInsertMenu, {
                  editor: props.editor,
                  props,
                  className: "thought-slash-command",
                });
                component = renderer;
                unmount = props.mount(renderer.element);
              },
              onUpdate: (props) => component?.updateProps(props),
              onKeyDown: ({ event }: SuggestionKeyDownProps) =>
                component?.ref?.onKeyDown(event) ?? false,
              onExit: () => {
                unmount?.();
                component?.destroy();
                unmount = null;
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}
