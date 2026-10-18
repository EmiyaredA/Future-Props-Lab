import { useState } from "react";
import { X } from "lucide-react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { SlidePreview } from "./SlideSurface";
import { applySlideTheme, themeMapping, slideTheme } from "./slideTheme";
import type { Slide } from "./types";
import "./slide-theme.css";

export function SlideThemeDialog({
  slide,
  onApply,
  onClose,
}: {
  slide: Slide;
  onApply: (slide: Slide) => void;
  onClose: () => void;
}) {
  const [mapping, setMapping] = useState(() => themeMapping(slide));
  const root = useDrawerFocus<HTMLDivElement>(onClose, true, false);
  const preview = applySlideTheme(slide, mapping);
  const changed = JSON.stringify(slide) !== JSON.stringify(preview);
  return (
    <div className="presentation-modal-backdrop">
      <div
        ref={root}
        className="presentation-theme-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="应用蓝青风格"
      >
        <header>
          <div>
            <h3>应用蓝青风格</h3>
            <p>仅调整当前页的配色与圆角，保留内容和布局。</p>
          </div>
          <button
            className="icon-btn"
            aria-label="关闭风格预览"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="presentation-theme-body">
          <div className="presentation-theme-preview" aria-label="换肤预览">
            <SlidePreview slide={preview} />
          </div>
          <div className="presentation-theme-colors">
            <h4>颜色替换</h4>
            <p>内置色已匹配；其他颜色默认保留，可逐项调整。</p>
            {Object.entries(mapping).map(([from, to]) => (
              <div className="presentation-theme-color" key={from}>
                <span>
                  <i style={{ background: from }} />
                  {from}
                </span>
                <span aria-hidden="true">→</span>
                <CustomColorPicker
                  ariaLabel={`替换颜色 ${from}`}
                  value={to}
                  colors={Object.values(slideTheme)}
                  onChange={(value) =>
                    setMapping((m) => ({ ...m, [from]: value }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <p className="muted">
          锁定元素、连接到锁定元素的线条、图片和 SVG
          素材保持原样。应用后可撤销。
        </p>
        <footer>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!changed}
            onClick={() => {
              onApply(preview);
              onClose();
            }}
          >
            应用到当前页
          </button>
        </footer>
      </div>
    </div>
  );
}
