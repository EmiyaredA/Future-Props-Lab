import { useBackdropDismiss } from "@shared/ui/useBackdropDismiss";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@platform/api/errors";
import { useAccountPermission } from "@platform/auth/AccountAccess";
import { cardsKey, createCard, listCards, type ScriptSeed } from "./api";
import { analyzeScript, extractCards, scriptText } from "./scriptAnalysis";
import { TextModelSelect } from "./TextModelSelect";

const cardNames = {
  character: "角色卡",
  scene: "场景卡",
  prop: "道具卡",
};

export function ScriptCardExtraction({
  project,
  seed,
  onClose,
}: {
  project: string;
  seed: ScriptSeed;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const canUseModels = useAccountPermission("models.use");
  const modal = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController>(null);
  const [model, setModel] = useState("");
  const [drafts, setDrafts] = useState<ReturnType<typeof extractCards>>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = modal.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      abort.current?.abort();
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const backdrop = useBackdropDismiss(() => {
    if (!busy) onClose();
  });
  return (
    <dialog
      ref={modal}
      {...backdrop}
      className="creative-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="creative-toolbar">
        <strong>从「{seed.scene.title}」提取设定</strong>
        <button
          type="button"
          className="creative-quiet"
          disabled={busy}
          onClick={onClose}
        >
          关闭
        </button>
      </header>
      <div className="creative-dialog-body">
        {canUseModels ? (
          <div className="creative-inline">
            <TextModelSelect
              value={model}
              onChange={setModel}
              disabled={busy}
            />
            <button
              className="creative-quiet"
              disabled={!model || busy}
              onClick={async () => {
                const controller = new AbortController();
                abort.current = controller;
                setBusy(true);
                setError("");
                try {
                  const items = extractCards(
                    await analyzeScript(
                      scriptText(seed.scene),
                      model,
                      controller.signal,
                    ),
                  );
                  const records = await listCards(controller.signal);
                  const existing = new Set(
                    records
                      .filter((card) => !card.archived)
                      .map((card) => `${card.kind}:${card.title}`),
                  );
                  const next = items.filter(
                    (item) => !existing.has(`${item.kind}:${item.name}`),
                  );
                  setDrafts(next);
                  setChecked(new Set(next.map((_, index) => index)));
                  if (!next.length) setError("本场没有新的设定可添加。");
                } catch (failure) {
                  if (!controller.signal.aborted)
                    setError(apiErrorMessage(failure));
                } finally {
                  if (!controller.signal.aborted) setBusy(false);
                }
              }}
            >
              {busy ? "处理中…" : "提取"}
            </button>
          </div>
        ) : (
          <p>当前账号没有模型使用权限。</p>
        )}
        {drafts.map((entry, index) => (
          <label
            key={`${entry.kind}:${entry.name}`}
            className="creative-choice"
          >
            <input
              type="checkbox"
              disabled={busy}
              checked={checked.has(index)}
              onChange={(event) => {
                const next = new Set(checked);
                if (event.target.checked) next.add(index);
                else next.delete(index);
                setChecked(next);
              }}
            />
            <span>
              <strong>{entry.name}</strong>
              <small>
                {cardNames[entry.kind]} · {entry.quote}
              </small>
            </span>
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
      <footer className="creative-toolbar">
        <button
          className="creative-primary"
          disabled={!checked.size || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const remaining = new Set(checked);
            try {
              for (const index of checked) {
                const entry = drafts[index];
                await createCard(project, {
                  kind: entry.kind,
                  title: entry.name,
                  source: seed.source,
                });
                remaining.delete(index);
              }
              onClose();
            } catch (failure) {
              setChecked(remaining);
              setError(apiErrorMessage(failure));
            } finally {
              await client.invalidateQueries({ queryKey: cardsKey });
              setBusy(false);
            }
          }}
        >
          添加到设定卡
        </button>
      </footer>
    </dialog>
  );
}
