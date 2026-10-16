import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { cellAround, pointsAtCell, TableMap } from "@tiptap/pm/tables";

export const TABLE_COLUMN_MIN_WIDTH = 60;
const HANDLE_WIDTH = 5;

const columnResizeKey = new PluginKey<ColumnResizeState>(
  "documentTableColumnResize",
);

type ColumnLayout =
  { mode: "fluid"; count: number } | { mode: "fixed"; widths: number[] };

export function resizeTableColumns(
  widths: readonly number[],
  columnIndex: number,
  requestedWidth: number,
  minWidth = TABLE_COLUMN_MIN_WIDTH,
): number[] {
  const next = widths.slice();
  if (columnIndex < 0 || columnIndex >= next.length) return next;
  next[columnIndex] = Math.max(minWidth, Math.round(requestedWidth));
  return next;
}

export function readColumnWidths(row: ProseMirrorNode): Array<number | null> {
  const widths: Array<number | null> = [];
  for (let index = 0; index < row.childCount; index += 1) {
    const cell = row.child(index);
    const colspan = numericAttr(cell.attrs.colspan, 1);
    const stored = cell.attrs.colwidth;
    for (let span = 0; span < colspan; span += 1) {
      const value = Array.isArray(stored) ? stored[span] : null;
      widths.push(explicitWidth(value));
    }
  }
  return widths;
}

export function fillMissingColumnWidths(
  widths: readonly (number | null)[],
  minWidth = TABLE_COLUMN_MIN_WIDTH,
): number[] | null {
  const hasGap = widths.some((width) => width == null);
  const hasWidth = widths.some((width) => width != null);
  if (!hasGap || !hasWidth) return null;
  return widths.map((width, index) => {
    if (width != null) return width;
    return Math.max(minWidth, Math.round(nearestExplicitWidth(widths, index)));
  });
}

export function resolvedColumnWidths(
  widths: readonly (number | null)[],
  minWidth = TABLE_COLUMN_MIN_WIDTH,
): number[] | null {
  if (widths.length === 0 || widths.every((width) => width == null))
    return null;
  return (
    fillMissingColumnWidths(widths, minWidth) ??
    widths.map((width) => width ?? minWidth)
  );
}

function nearestExplicitWidth(
  widths: readonly (number | null)[],
  index: number,
): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const width = widths[cursor];
    if (width != null) return width;
  }
  for (let cursor = index + 1; cursor < widths.length; cursor += 1) {
    const width = widths[cursor];
    if (width != null) return width;
  }
  return TABLE_COLUMN_MIN_WIDTH;
}

function explicitWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function numericAttr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function layoutForTable(
  node: ProseMirrorNode,
  minWidth: number,
): ColumnLayout | null {
  const row = node.firstChild;
  if (!row) return null;
  const widths = resolvedColumnWidths(readColumnWidths(row), minWidth);
  if (!widths) return { mode: "fluid", count: readColumnWidths(row).length };
  return { mode: "fixed", widths };
}

function paintColumnLayout(
  table: HTMLTableElement,
  layout: ColumnLayout,
  minWidth: number,
) {
  const colgroup =
    table.firstElementChild?.tagName === "COLGROUP"
      ? table.firstElementChild
      : table.insertBefore(
          document.createElement("colgroup"),
          table.firstChild,
        );
  const count = layout.mode === "fixed" ? layout.widths.length : layout.count;
  while (colgroup.childElementCount < count) {
    colgroup.appendChild(document.createElement("col"));
  }
  while (colgroup.childElementCount > count)
    colgroup.lastElementChild?.remove();
  for (let index = 0; index < count; index += 1) {
    const column = colgroup.children[index] as HTMLElement;
    if (layout.mode === "fixed") {
      column.style.width = `${layout.widths[index]}px`;
      column.style.minWidth = "";
    } else {
      column.style.width = "";
      column.style.minWidth = `${minWidth}px`;
    }
  }
  if (layout.mode === "fixed") {
    const total = layout.widths.reduce((sum, width) => sum + width, 0);
    table.dataset.fixedColumns = "true";
    table.style.width = `${total}px`;
    table.style.minWidth = "";
  } else {
    delete table.dataset.fixedColumns;
    table.style.width = "";
    table.style.minWidth = "";
  }
}

function currentColumnWidths(table: HTMLTableElement, columnCount: number) {
  if (table.dataset.fixedColumns === "true") {
    const columns = Array.from(
      table.querySelectorAll(":scope > colgroup > col"),
    );
    if (columns.length === columnCount) {
      const widths = columns.map((column) => {
        const parsed = Number.parseFloat((column as HTMLElement).style.width);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      });
      if (widths.every((width) => width != null)) return widths as number[];
    }
  }
  return measureColumnWidths(table, columnCount);
}

function measureColumnWidths(
  table: HTMLTableElement,
  columnCount: number,
): number[] | null {
  const widths: Array<number | null> = Array.from(
    { length: columnCount },
    () => null,
  );
  const spanned: Array<{ start: number; width: number; span: number }> = [];
  for (const row of Array.from(table.rows)) {
    let column = 0;
    for (const cell of Array.from(row.cells)) {
      const span = cell.colSpan || 1;
      const width = cell.getBoundingClientRect().width;
      if (span === 1) {
        if (widths[column] == null) widths[column] = width;
      } else spanned.push({ start: column, width, span });
      column += span;
    }
  }
  for (const region of spanned) {
    const unknown: number[] = [];
    let known = 0;
    for (let offset = 0; offset < region.span; offset += 1) {
      const value = widths[region.start + offset];
      if (value == null) unknown.push(region.start + offset);
      else known += value;
    }
    if (unknown.length === 0) continue;
    const share = Math.max(0, region.width - known) / unknown.length;
    for (const index of unknown) widths[index] = share;
  }
  if (widths.some((width) => width == null || width < 1)) return null;
  return widths.map((width) => Math.round(width as number));
}

export class DocumentTableView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLTableSectionElement;
  private readonly table: HTMLTableElement;
  private node: ProseMirrorNode;

  constructor(
    node: ProseMirrorNode,
    private readonly cellMinWidth: number,
    _editorView: EditorView,
    attributes: Record<string, unknown> = {},
  ) {
    this.node = node;
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    for (const [key, value] of Object.entries(attributes)) {
      if (value == null) continue;
      if (key === "style") this.table.style.cssText = String(value);
      else this.table.setAttribute(key, String(value));
    }
    if (typeof node.attrs.style === "string") {
      this.table.style.cssText = node.attrs.style;
    }
    this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.paint();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.paint();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target;
    if (!(target instanceof Node)) return false;
    const insideWrapper = this.dom.contains(target);
    const insideContent = this.contentDOM.contains(target);
    return (
      insideWrapper &&
      !insideContent &&
      (mutation.type === "attributes" ||
        mutation.type === "childList" ||
        mutation.type === "characterData")
    );
  }

  private paint() {
    const layout = layoutForTable(this.node, this.cellMinWidth);
    if (layout) paintColumnLayout(this.table, layout, this.cellMinWidth);
  }
}

class ColumnResizeState {
  constructor(
    readonly activeHandle: number,
    readonly dragging: boolean,
  ) {}

  apply(tr: Transaction) {
    const meta = tr.getMeta(columnResizeKey) as
      { setHandle?: number; setDragging?: boolean } | undefined;
    if (meta && meta.setHandle != null) {
      return new ColumnResizeState(meta.setHandle, false);
    }
    if (meta && meta.setDragging != null) {
      return new ColumnResizeState(this.activeHandle, meta.setDragging);
    }
    if (this.activeHandle > -1 && tr.docChanged) {
      const mapped = tr.mapping.map(this.activeHandle, -1);
      const handle = pointsAtCell(tr.doc.resolve(mapped)) ? mapped : -1;
      return new ColumnResizeState(handle, this.dragging);
    }
    return this;
  }
}

type ActiveDrag = {
  startX: number;
  column: number;
  widths: number[];
  table: HTMLTableElement;
  tablePos: number;
  releasePointer: () => void;
};

function columnGeometry(doc: ProseMirrorNode, cellPos: number) {
  const $cell = doc.resolve(cellPos);
  let tableDepth = -1;
  for (let depth = $cell.depth; depth > 0; depth -= 1) {
    if ($cell.node(depth).type.spec.tableRole === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0 || !$cell.nodeAfter) return null;
  const table = $cell.node(tableDepth);
  const map = TableMap.get(table);
  const column =
    map.colCount($cell.pos - $cell.start(tableDepth)) +
    numericAttr($cell.nodeAfter.attrs.colspan, 1) -
    1;
  return { column, tablePos: $cell.before(tableDepth), map };
}

export function applyTableColumnWidths(
  tr: Transaction,
  tablePos: number,
  widths: readonly number[],
) {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.spec.tableRole !== "table") return false;
  const map = TableMap.get(table);
  if (widths.length !== map.width) return false;
  const tableStart = tablePos + 1;
  let changed = false;
  for (let row = 0; row < map.height; row += 1) {
    for (let column = 0; column < map.width; column += 1) {
      const index = row * map.width + column;
      const pos = map.map[index];
      if (row > 0 && pos === map.map[index - map.width]) continue;
      if (column > 0 && pos === map.map[index - 1]) continue;
      const cell = table.nodeAt(pos);
      if (!cell) continue;
      const colspan = numericAttr(cell.attrs.colspan, 1);
      const colwidth = widths.slice(column, column + colspan).map((width) => {
        return Math.round(width);
      });
      const current = cell.attrs.colwidth;
      if (
        Array.isArray(current) &&
        current.length === colwidth.length &&
        current.every((width, offset) => width === colwidth[offset])
      ) {
        continue;
      }
      tr.setNodeMarkup(tableStart + pos, null, { ...cell.attrs, colwidth });
      changed = true;
    }
  }
  return changed;
}

function domCell(target: EventTarget | null) {
  let node = target instanceof globalThis.Node ? target : null;
  while (node && node.nodeName !== "TD" && node.nodeName !== "TH") {
    if (node instanceof HTMLElement && node.classList.contains("ProseMirror")) {
      return null;
    }
    node = node.parentNode;
  }
  return node instanceof HTMLTableCellElement ? node : null;
}

function edgeCell(view: EditorView, event: MouseEvent, side: "left" | "right") {
  const offset = side === "right" ? -HANDLE_WIDTH : HANDLE_WIDTH;
  const found = view.posAtCoords({
    left: event.clientX + offset,
    top: event.clientY,
  });
  if (!found) return -1;
  const $cell = cellAround(view.state.doc.resolve(found.pos));
  if (!$cell) return -1;
  if (side === "right") return $cell.pos;
  const map = TableMap.get($cell.node(-1));
  const index = map.map.indexOf($cell.pos - $cell.start(-1));
  return index % map.width === 0 ? -1 : $cell.start(-1) + map.map[index - 1];
}

function updateHandle(view: EditorView, handle: number) {
  view.dispatch(view.state.tr.setMeta(columnResizeKey, { setHandle: handle }));
}

function handleDecorations(state: EditorState) {
  const handle = columnResizeKey.getState(state)?.activeHandle ?? -1;
  if (handle < 0) return DecorationSet.empty;
  const geometry = columnGeometry(state.doc, handle);
  if (!geometry) return DecorationSet.empty;
  const $cell = state.doc.resolve(handle);
  let tableDepth = -1;
  for (let depth = $cell.depth; depth > 0; depth -= 1) {
    if ($cell.node(depth).type.spec.tableRole === "table") {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 0) return DecorationSet.empty;
  const table = $cell.node(tableDepth);
  const tableStart = $cell.start(tableDepth);
  const decorations = [];
  for (let row = 0; row < geometry.map.height; row += 1) {
    const index = geometry.column + row * geometry.map.width;
    const continuesRight =
      geometry.column < geometry.map.width - 1 &&
      geometry.map.map[index] === geometry.map.map[index + 1];
    const continuesAbove =
      row > 0 &&
      geometry.map.map[index] === geometry.map.map[index - geometry.map.width];
    if (continuesRight || continuesAbove) continue;
    const cellPos = geometry.map.map[index];
    const cell = table.nodeAt(cellPos);
    if (!cell) continue;
    const widget = document.createElement("div");
    widget.className = "column-resize-handle";
    decorations.push(
      Decoration.widget(tableStart + cellPos + cell.nodeSize - 1, widget, {
        ignoreSelection: true,
      }),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

export const documentTableColumnResize = Extension.create({
  name: "documentTableColumnResize",
  addProseMirrorPlugins() {
    const minWidth = TABLE_COLUMN_MIN_WIDTH;
    let drag: ActiveDrag | null = null;
    let stopDrag: (() => void) | null = null;

    const finishDrag = (
      view: EditorView,
      event: MouseEvent,
      commit: boolean,
    ) => {
      const active = drag;
      stopDrag?.();
      stopDrag = null;
      drag = null;
      if (!active) return;
      const widths = commit
        ? resizeTableColumns(
            active.widths,
            active.column,
            active.widths[active.column] + (event.clientX - active.startX),
            minWidth,
          )
        : active.widths;
      if (view.isDestroyed) return;
      const tr = view.state.tr;
      if (
        commit &&
        widths.some((width, index) => width !== active.widths[index])
      ) {
        applyTableColumnWidths(tr, active.tablePos, widths);
      }
      tr.setMeta(columnResizeKey, { setDragging: false, setHandle: -1 });
      view.dispatch(tr);
    };

    return [
      new Plugin({
        key: columnResizeKey,
        state: {
          init: () => new ColumnResizeState(-1, false),
          apply: (tr, previous) => previous.apply(tr),
        },
        view: () => ({
          destroy: () => {
            stopDrag?.();
            stopDrag = null;
            drag = null;
          },
        }),
        props: {
          attributes: (state): Record<string, string> => {
            const pluginState = columnResizeKey.getState(state);
            return pluginState && pluginState.activeHandle > -1
              ? { class: "resize-cursor" }
              : {};
          },
          decorations: handleDecorations,
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (!view.editable || drag) return false;
              const pluginState = columnResizeKey.getState(view.state);
              if (!pluginState) return false;
              const target = domCell(event.target);
              let cell = -1;
              if (target) {
                const rect = target.getBoundingClientRect();
                if (event.clientX - rect.left <= HANDLE_WIDTH) {
                  cell = edgeCell(view, event, "left");
                } else if (rect.right - event.clientX <= HANDLE_WIDTH) {
                  cell = edgeCell(view, event, "right");
                }
              }
              if (cell !== pluginState.activeHandle) updateHandle(view, cell);
              return false;
            },
            mouseleave: (view) => {
              if (!view.editable || drag) return false;
              const pluginState = columnResizeKey.getState(view.state);
              if (pluginState && pluginState.activeHandle > -1)
                updateHandle(view, -1);
              return false;
            },
            mousedown: (view, event) => {
              if (!view.editable || event.button !== 0 || drag) return false;
              const pluginState = columnResizeKey.getState(view.state);
              if (!pluginState || pluginState.activeHandle < 0) return false;
              const geometry = columnGeometry(
                view.state.doc,
                pluginState.activeHandle,
              );
              const cell = domCell(event.target);
              const table = cell?.closest("table");
              if (!geometry || !table) return false;
              const measured = currentColumnWidths(table, geometry.map.width);
              if (!measured) return false;
              const widths = measured.map((width) => Math.round(width));
              const previousCursor = document.body.style.cursor;
              const previousSelect = document.body.style.userSelect;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
              const releasePointer = () => {
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousSelect;
              };
              drag = {
                startX: event.clientX,
                column: geometry.column,
                widths,
                table,
                tablePos: geometry.tablePos,
                releasePointer,
              };
              const move = (moveEvent: MouseEvent) => {
                if (!drag) return;
                if (!moveEvent.buttons) {
                  finishDrag(view, moveEvent, true);
                  return;
                }
                const next = resizeTableColumns(
                  drag.widths,
                  drag.column,
                  drag.widths[drag.column] + (moveEvent.clientX - drag.startX),
                  minWidth,
                );
                paintColumnLayout(
                  drag.table,
                  { mode: "fixed", widths: next },
                  minWidth,
                );
              };
              const up = (upEvent: MouseEvent) =>
                finishDrag(view, upEvent, true);
              stopDrag = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
                releasePointer();
              };
              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", up);
              view.dispatch(
                view.state.tr.setMeta(columnResizeKey, { setDragging: true }),
              );
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
