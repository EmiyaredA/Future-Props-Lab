import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { accountQueryKeys } from "./queryKeys";
import { fetchQuotas, saveQuotas } from "./platformApi";
import { ManagementError } from "./ManagementUi";
import { useManagementDraft } from "./useManagementDraft";
export function RuntimeQuotasPage() {
  const quotas = useQuery({
    queryKey: accountQueryKeys.quotas,
    queryFn: fetchQuotas,
  });
  return (
    <section className="management-page">
      <header className="management-page-head">
        <div>
          <h1>运行额度</h1>
          <p>管理账号与整个平台的并发和排队上限。</p>
        </div>
      </header>
      <ManagementError error={quotas.error} />
      {quotas.data && <QuotaEditor initial={quotas.data} />}
    </section>
  );
}
function QuotaEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof fetchQuotas>>;
}) {
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState(initial.value);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(current.value) !== JSON.stringify(draft);
  useManagementDraft("runtime-quotas", dirty);
  return (
    <form
      className="management-list-panel governance-panel"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void saveQuotas({ expected_revision: current.revision, value: draft })
          .then((result) => {
            setCurrent(result);
            setDraft(result.value);
          })
          .catch(setError)
          .finally(() => setBusy(false));
      }}
    >
      <header>
        <SlidersHorizontal size={22} />
        <div>
          <h2>并发配额</h2>
          <p>
            图片和视频额度不足时自动排队；等待上限按账号合计，0
            表示关闭排队。其他调用额度不足时拒绝。
          </p>
        </div>
      </header>
      <div className="governance-quota-grid">
        {(
          [
            ["user", "普通用户"],
            ["admin", "管理员"],
            ["instance", "整个平台"],
          ] as const
        ).map(([role, label]) => (
          <fieldset key={role}>
            <legend>{label}</legend>
            {(["total", "realtime_voice"] as const).map((key) => (
              <label key={key}>
                {key === "total" ? "总并发" : "实时语音"}
                <input
                  type="number"
                  min={role === "instance" && key === "total" ? 1 : 0}
                  max={1024}
                  required
                  value={draft[role][key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [role]: { ...draft[role], [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
            {role !== "instance" && (
              <label>
                图片／视频等待上限
                <input
                  type="number"
                  min={0}
                  max={1024}
                  required
                  value={draft.generation_queue?.[role] ?? 20}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      generation_queue: {
                        user: 20,
                        admin: 20,
                        ...draft.generation_queue,
                        [role]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            )}
          </fieldset>
        ))}
        <label>
          管理员预留总额度
          <input
            type="number"
            min={0}
            max={1024}
            required
            value={draft.reserved_for_admins}
            onChange={(e) =>
              setDraft({
                ...draft,
                reserved_for_admins: Number(e.target.value),
              })
            }
          />
        </label>
      </div>
      <ManagementError error={error} />
      <footer>
        <span>{dirty ? "有尚未保存的更改" : "并发额度已保存"}</span>
        <div className="button-row">
          {!!error && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void fetchQuotas()
                  .then((latest) => {
                    setCurrent(latest);
                    setError(null);
                  })
                  .catch(setError)
              }
            >
              读取最新版本，保留草稿
            </button>
          )}
          <button className="btn primary" disabled={busy || !dirty}>
            保存并发配额
          </button>
        </div>
      </footer>
    </form>
  );
}
