import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { accountQueryKeys } from "./queryKeys";
import { fetchManagedAccounts } from "./managementApi";
import type { PlatformRole } from "./platformApi";
import { ManagementError } from "./ManagementUi";

export function TemplateSyncTarget({
  role,
  onChange,
}: {
  role: PlatformRole;
  onChange: (id: string | null) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");
  const filters = {
    q: query,
    status: "active" as const,
    platform_role: role,
    page: 1,
    page_size: 100,
  };
  const accounts = useQuery({
    queryKey: accountQueryKeys.accounts(filters),
    queryFn: () => fetchManagedAccounts(filters),
    enabled,
  });
  const options = (accounts.data?.items || []).map((account) => ({
    value: account.id,
    label: `${account.display_name} · @${account.username}`,
  }));
  if (selected && !options.some((option) => option.value === selected))
    options.unshift({ value: selected, label });
  return (
    <section className="management-list-panel governance-panel">
      <header>
        <div>
          <h2>同步范围</h2>
          <p>角色模板用于新账号；已有账号可以选择单独分配。</p>
        </div>
      </header>
      <button
        type="button"
        className="btn"
        aria-pressed={enabled}
        onClick={() => {
          setEnabled(!enabled);
          setSelected("");
          onChange(enabled ? null : "");
        }}
      >
        {enabled ? "改为同步该身份全部账号" : "仅同步指定账号"}
      </button>
      {enabled && (
        <div className="governance-target-form">
          <label>
            查找账号
            <input
              aria-label="查找同步账号"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="用户名或展示名"
            />
          </label>
          <label>
            同步目标账号
            <CustomSelect
              value={selected}
              options={[
                {
                  value: "",
                  label: accounts.isFetching ? "正在读取账号…" : "请选择账号",
                },
                ...options,
              ]}
              onChange={(id) => {
                setSelected(id);
                setLabel(
                  options.find((option) => option.value === id)?.label || "",
                );
                onChange(id);
              }}
              ariaLabel="同步目标账号"
            />
          </label>
          <ManagementError error={accounts.error} />
        </div>
      )}
    </section>
  );
}
