import { useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { Slide, SlideElement } from "../types";
export function LinkEditor({
  element,
  slides,
  change,
  disabled,
}: {
  element: SlideElement;
  slides: Slide[];
  change: (link: SlideElement["link"]) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState(
    element.link?.type === "web" ? element.link.target : "",
  );
  const [error, setError] = useState("");
  return (
    <fieldset disabled={disabled}>
      <legend>元素超链接</legend>
      <input
        aria-label="网页链接地址"
        value={value}
        placeholder="https://…"
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="btn"
        onClick={() => {
          try {
            const url = new URL(value);
            if (!["https:", "http:"].includes(url.protocol)) throw new Error();
            change({ type: "web", target: url.href });
            setError("");
          } catch {
            setError("请输入完整的 HTTP/HTTPS 网页地址");
          }
        }}
      >
        应用网页链接
      </button>
      <CustomSelect
        ariaLabel="链接到幻灯片"
        disabled={disabled}
        value={element.link?.type === "slide" ? element.link.target : ""}
        options={[
          { value: "", label: "选择目标幻灯片", disabled: true },
          ...slides.map((s, i) => ({
            value: s.id,
            label: `第 ${i + 1} 页${s.section ? ` · ${s.section}` : ""}`,
          })),
        ]}
        onChange={(target) => change({ type: "slide", target })}
      />
      <button
        className="btn"
        disabled={disabled || !element.link}
        onClick={() => change(null)}
      >
        移除链接
      </button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
