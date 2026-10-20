import { Extension, Mark } from "@tiptap/core";
export const ScriptMark = Mark.create({
  name: "script",
  addAttributes() {
    return { kind: { default: "sup" } };
  },
  parseHTML() {
    return [
      { tag: "sup", attrs: { kind: "sup" } },
      { tag: "sub", attrs: { kind: "sub" } },
    ];
  },
  renderHTML({ mark }) {
    return [mark.attrs.kind === "sub" ? "sub" : "sup", {}, 0];
  },
});
export const ParagraphStyle = Extension.create({
  name: "presentationParagraphStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          lineHeight: {
            default: 1.3,
            parseHTML: (el) => Number(el.dataset.lineHeight) || 1.3,
            renderHTML: (attrs) => ({
              "data-line-height": attrs.lineHeight,
              style: `line-height: ${attrs.lineHeight}`,
            }),
          },
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.dataset.indent) || 0,
            renderHTML: (attrs) => ({
              "data-indent": String(attrs.indent),
              style: `margin-left:${attrs.indent * 2}em`,
            }),
          },
          firstLineIndent: {
            default: 0,
            parseHTML: (el) => Number(el.dataset.firstLineIndent) || 0,
            renderHTML: (attrs) => ({
              "data-first-line-indent": String(attrs.firstLineIndent),
              style: `text-indent:${attrs.firstLineIndent}px`,
            }),
          },
          spaceBefore: {
            default: 0,
            parseHTML: (el) => Number(el.dataset.spaceBefore) || 0,
            renderHTML: (attrs) => ({
              "data-space-before": String(attrs.spaceBefore),
              style: `margin-top:${attrs.spaceBefore}px`,
            }),
          },
          spaceAfter: {
            default: 0,
            parseHTML: (el) => Number(el.dataset.spaceAfter) || 0,
            renderHTML: (attrs) => ({
              "data-space-after": String(attrs.spaceAfter),
              style: `margin-bottom:${attrs.spaceAfter}px`,
            }),
          },
          bullet: {
            default: false,
            parseHTML: (el) => el.dataset.bullet === "true",
            renderHTML: (attrs) => ({ "data-bullet": String(attrs.bullet) }),
          },
          numbered: {
            default: false,
            parseHTML: (el) => el.dataset.numbered === "true",
            renderHTML: (attrs) => ({
              "data-numbered": String(attrs.numbered),
            }),
          },
        },
      },
    ];
  },
});
