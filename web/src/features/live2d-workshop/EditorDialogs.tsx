import { AMADEUS_PACKAGE_URL } from "@shared/live2d/bundled";
import { Modal } from "./Controls";

export function BuiltInExport() {
  return (
    <section className="l2-builtin-export">
      <h2>内置只读案例</h2>
      <p>
        可查看图层、骨骼、蒙皮、参数、动作和状态绑定。创建副本后即可编辑并交付。
      </p>
      <a href={AMADEUS_PACKAGE_URL} download="amadeus.fpllive2d">
        下载原生工程包
      </a>
    </section>
  );
}

export function EditorDialogs({
  confirmation,
  onDismissConfirmation,
  onConfirm,
  leaving,
  onDismissLeaving,
  onDiscard,
  onSaveLeave,
  busy,
  saving,
  conflict,
}: {
  confirmation: { message: string; action: () => void } | null;
  onDismissConfirmation: () => void;
  onConfirm: () => void;
  leaving: boolean;
  onDismissLeaving: () => void;
  onDiscard: () => void;
  onSaveLeave: () => void;
  busy: boolean;
  saving: boolean;
  conflict: boolean;
}) {
  return (
    <>
      <Modal
        title="确认编辑操作"
        description={confirmation?.message ?? ""}
        open={!!confirmation}
        onClose={onDismissConfirmation}
      >
        <div className="l2-actions">
          <button onClick={onDismissConfirmation}>取消</button>
          <button className="l2-primary" onClick={onConfirm}>
            确认
          </button>
        </div>
      </Modal>
      <Modal
        title="离开角色编辑器？"
        description="当前修改尚未保存，或素材仍在导入。可以保存后离开，也可以留在此处继续编辑。"
        open={leaving}
        onClose={onDismissLeaving}
      >
        <div className="l2-actions">
          <button onClick={onDismissLeaving}>继续编辑</button>
          <button onClick={onDiscard}>放弃并离开</button>
          <button
            className="l2-primary"
            disabled={busy || saving || conflict}
            onClick={onSaveLeave}
          >
            保存后离开
          </button>
        </div>
      </Modal>
    </>
  );
}
