import type { SegmentTranscriptionController } from "@features/audio-annotation/segmentTranscription";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";

export function SegmentTranscriptionDialogs({
  controller,
}: {
  controller: SegmentTranscriptionController;
}) {
  const { confirmTarget, completed } = controller;
  return (
    <>
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={`替换${confirmTarget?.label ?? "当前语言"}内容？`}
        description="当前语言版本已有文字。转写完成后会用新结果替换现有内容，并将片段恢复为待校对。"
        confirmLabel="确认并转写"
        onCancel={() => controller.setConfirmTarget(null)}
        onConfirm={() => {
          controller.setConfirmTarget(null);
          if (confirmTarget) controller.start(confirmTarget);
        }}
      />
      <ConfirmDialog
        open={Boolean(completed)}
        title="转写期间内容已变化，仍要替换吗？"
        description="为避免覆盖刚刚的编辑，转写结果尚未写入。确认后会替换目标语言版本的最新内容。"
        confirmLabel="替换为转写结果"
        onCancel={() => controller.setCompleted(null)}
        onConfirm={() => {
          controller.setCompleted(null);
          if (
            completed &&
            controller.applyText(completed.target, completed.text)
          )
            controller.setNotice(
              `已自动识别语音并转写到${completed.target.label}。`,
            );
        }}
      />
    </>
  );
}
