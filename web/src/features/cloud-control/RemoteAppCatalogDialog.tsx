import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { reauthenticate } from "@features/accounts";
import {
  readInstalledRemoteApps,
  saveRemoteApps,
  type InstalledRemoteApps,
} from "./cloudApi";

function CatalogForm({
  initial,
  changed,
  close,
}: {
  initial: InstalledRemoteApps;
  changed: (catalog: InstalledRemoteApps) => void;
  close: () => void;
}) {
  const [ids, setIds] = useState(initial.allowed_ids);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"recommended" | "installed">("recommended");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filtered = initial.apps.filter(
    (item) =>
      (tab === "installed" || item.recommended) &&
      item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await reauthenticate(password);
      setPassword("");
      const saved = await saveRemoteApps({
        revision: initial.revision,
        app_ids: ids,
      });
      changed(saved);
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法保存应用名单");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <div role="group" aria-label="应用来源" className="cloud-app-source">
        <button
          className="btn"
          type="button"
          aria-pressed={tab === "recommended"}
          onClick={() => setTab("recommended")}
        >
          常用应用
        </button>
        <button
          className="btn"
          type="button"
          aria-pressed={tab === "installed"}
          onClick={() => setTab("installed")}
        >
          已安装应用
        </button>
      </div>
      <label>
        搜索应用
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className="cloud-app-catalog">
        {filtered.map((item) => {
          const added = ids.includes(item.id);
          return (
            <li key={item.id}>
              <span>{item.name}</span>
              <button
                type="button"
                className="btn"
                aria-label={`${added ? "移除" : "添加"} ${item.name}`}
                disabled={busy || (!added && ids.length >= 32)}
                onClick={() =>
                  setIds((current) =>
                    added
                      ? current.filter((id) => id !== item.id)
                      : [...current, item.id],
                  )
                }
              >
                {added ? <X size={15} /> : <Plus size={15} />}{" "}
                {added ? "移除" : "添加"}
              </button>
            </li>
          );
        })}
      </ul>
      {!filtered.length && <p>没有匹配的应用。</p>}
      {ids
        .filter((id) => !initial.apps.some((item) => item.id === id))
        .map((id) => (
          <button
            className="btn"
            type="button"
            key={id}
            onClick={() =>
              setIds((items) => items.filter((item) => item !== id))
            }
          >
            <X size={15} /> 移除已卸载应用（{id.slice(0, 6)}）
          </button>
        ))}
      <label>
        FPL 管理员密码
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="cloud-dialog-actions">
        <button className="btn" type="button" onClick={close} disabled={busy}>
          取消
        </button>
        <button className="btn cloud-primary" type="submit" disabled={busy}>
          保存应用名单
        </button>
      </div>
    </form>
  );
}

export function RemoteAppCatalogDialog({
  owner,
  local,
  changed,
  close,
}: {
  owner: string;
  local: boolean;
  changed: (catalog: InstalledRemoteApps) => void;
  close: () => void;
}) {
  const catalog = useQuery({
    queryKey: ["cloud-control", owner, "installed-apps"],
    queryFn: ({ signal }) => readInstalledRemoteApps(signal),
    enabled: local,
    gcTime: 0,
  });

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cloud-dialog-overlay" />
        <Dialog.Content className="cloud-dialog cloud-app-catalog-dialog">
          <Dialog.Title>添加远程应用</Dialog.Title>
          <Dialog.Description>
            {local
              ? "选定允许远程连接的 Mac 应用。"
              : "应用名单由运行云控的 Mac 管理。"}
          </Dialog.Description>
          {!local && (
            <p>
              请在 Mac
              上打开本机的「云控」，点击「添加应用」，选择已安装的应用并验证管理员密码。保存后，回到这里即可看到新应用。
            </p>
          )}
          {local && catalog.isPending && (
            <p role="status">正在读取 Mac 应用…</p>
          )}
          {local && catalog.error && (
            <p role="alert">{catalog.error.message}</p>
          )}
          {local && catalog.data && (
            <CatalogForm
              initial={catalog.data}
              changed={changed}
              close={close}
            />
          )}
          {(!local || !catalog.data) && (
            <Dialog.Close className="btn">关闭</Dialog.Close>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
