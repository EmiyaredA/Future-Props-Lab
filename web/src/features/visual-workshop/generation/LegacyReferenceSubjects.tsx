import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { X } from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { subjectLabel, type ReferenceSubjects } from "./referenceSubjects";

export function LegacyReferenceSubjects({
  legacy,
  images,
  titleFor,
  keyFor,
  onSave,
}: {
  legacy: string;
  images: string[];
  titleFor: (id: string) => string;
  keyFor: (id: string) => string;
  onSave: (value: ReferenceSubjects) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const targets = [
    ...new Set(
      legacy
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return (
    <>
      <button
        type="button"
        className="reference-legacy-trigger"
        onClick={() => setOpen(true)}
      >
        待关联目标 {targets.length}
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="reference-dialog-overlay" />
          <Dialog.Content
            className="reference-dialog"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header>
              <Dialog.Title>关联旧追踪对象</Dialog.Title>
              <Dialog.Close aria-label="关闭目标关联">
                <X size={18} />
              </Dialog.Close>
            </header>
            <Dialog.Description>
              原目标：{targets.join(", ")}
              。图片数量与目标数量不同，请分配目标；保存前继续沿用原调用参数。
            </Dialog.Description>
            {images.map((id) => (
              <label key={id}>
                {titleFor(id)}
                <CustomSelect
                  ariaLabel={`关联目标 ${titleFor(id)}`}
                  value={choices[id] ?? ""}
                  onChange={(value) => setChoices({ ...choices, [id]: value })}
                  options={[
                    { value: "", label: "不指定" },
                    ...targets.map((value) => ({
                      value,
                      label: subjectLabel(value),
                    })),
                  ]}
                />
              </label>
            ))}
            <footer>
              <button
                type="button"
                className="board-primary"
                disabled={!images.length}
                onClick={() => {
                  onSave(
                    Object.fromEntries(
                      Object.entries(choices)
                        .filter(([, value]) => value)
                        .map(([id, value]) => [keyFor(id), value]),
                    ),
                  );
                  setOpen(false);
                }}
              >
                保存图片关联
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
