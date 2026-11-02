import { useTransferProgress } from "@platform/api/useTransferProgress";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { containDialogComposition } from "../dialogKeyboard";
import { useState } from "react";
import { X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import type { Slide } from "../types";
import { PresentationImages } from "../PresentationImages";
import { ElementImage } from "../SlideSurface";
import { newElement } from "../templates";
import { uploadImage } from "../api";

export function ReferenceDialog({
  slide,
  onChange,
  onClose,
}: {
  slide: Slide;
  onChange: (value: Slide["reference"]) => void;
  onClose: () => void;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [picking, setPicking] = useState(!slide.reference),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const root = useDrawerFocus<HTMLDivElement>(onClose, !picking, false);
  const choose = (asset_id: string) => {
    onChange({ asset_id, opacity: 0.35, visible: true, mode: "side" });
    setPicking(false);
  };
  if (picking)
    return (
      <>
        <TransferFeedback progress={activeTransferProgress} />
        <PresentationImages
          onChoose={choose}
          onClose={onClose}
          busy={busy}
          error={error}
          onUpload={async (file) => {
            setBusy(true);
            setError("");
            try {
              choose(
                (
                  await runTransfer((onProgress) =>
                    uploadImage(file, { onProgress }),
                  )
                ).id,
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "上传失败");
            } finally {
              setBusy(false);
            }
          }}
        />
      </>
    );
  const reference = slide.reference;
  return (
    <div className="presentation-modal-backdrop">
      <TransferFeedback progress={activeTransferProgress} />

      <div
        onKeyDownCapture={containDialogComposition}
        ref={root}
        className="presentation-dialog presentation-dialog-small presentation-scene-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="参考图设置"
        data-presentation-history="document"
      >
        <header>
          <h3>参考图</h3>
          <button
            className="icon-btn"
            aria-label="关闭参考图设置"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="presentation-dialog-body">
          {reference && (
            <>
              <div className="presentation-reference-thumbnail">
                <ElementImage
                  element={newElement("image", {
                    asset_id: reference.asset_id,
                  })}
                  contain
                />
              </div>
              <CustomSelect
                ariaLabel="参考图显示方式"
                value={reference.mode ?? "side"}
                options={[
                  { value: "side", label: "并排对照" },
                  { value: "overlay", label: "透明叠加" },
                ]}
                onChange={(mode) =>
                  onChange({ ...reference, mode: mode as "side" | "overlay" })
                }
              />
              <label>
                叠加透明度
                <input
                  aria-label="参考图透明度"
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={reference.opacity ?? 0.35}
                  onChange={(e) =>
                    onChange({ ...reference, opacity: Number(e.target.value) })
                  }
                />
              </label>
              <label className="presentation-scene-checkbox">
                <input
                  type="checkbox"
                  checked={reference.visible !== false}
                  onChange={(e) =>
                    onChange({ ...reference, visible: e.target.checked })
                  }
                />
                显示参考图
              </label>
            </>
          )}
          <p>参考图用于重建对照，放映和 PPTX 中不包含此图。</p>
        </div>
        <footer>
          <button className="btn" onClick={() => setPicking(true)}>
            更换参考图
          </button>
          <button
            className="btn"
            onClick={() => {
              onChange(null);
              onClose();
            }}
          >
            移除参考图
          </button>
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ReferenceView({
  slide,
  overlay = false,
}: {
  slide: Slide;
  overlay?: boolean;
}) {
  const reference = slide.reference;
  if (
    !reference ||
    reference.visible === false ||
    (reference.mode === "overlay") !== overlay
  )
    return null;
  return (
    <div
      className={
        overlay
          ? "presentation-reference-overlay"
          : "presentation-reference-side"
      }
      style={overlay ? { opacity: reference.opacity ?? 0.35 } : undefined}
      aria-label="页面参考图"
    >
      <ElementImage
        element={newElement("image", { asset_id: reference.asset_id })}
        contain
      />
    </div>
  );
}
