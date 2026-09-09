import { useQueries } from "@tanstack/react-query";
import { Users, UserCheck, UserX, ShieldCheck } from "lucide-react";
import { fetchManagedAccounts, type AccountFilters } from "./managementApi";
import { accountQueryKeys } from "./queryKeys";
const cards = [
  { label: "全部账号", note: "平台中的全部账号", icon: Users, filter: {} },
  {
    label: "已启用",
    note: "可正常登录",
    icon: UserCheck,
    filter: { status: "active" },
  },
  {
    label: "已禁用",
    note: "已暂停登录资格",
    icon: UserX,
    filter: { status: "disabled" },
  },
  {
    label: "超级管理员",
    note: "拥有完整平台治理权限",
    icon: ShieldCheck,
    filter: { is_platform_admin: true },
  },
] as const;
export function AccountStatistics() {
  const counts = useQueries({
    queries: cards.map((card) => {
      const filters: AccountFilters = {
        q: "",
        page: 1,
        page_size: 1,
        ...card.filter,
      };
      return {
        queryKey: accountQueryKeys.accounts(filters),
        queryFn: () => fetchManagedAccounts(filters),
        select: (result: Awaited<ReturnType<typeof fetchManagedAccounts>>) =>
          result.total,
      };
    }),
  });
  return (
    <div className="management-stat-grid">
      {cards.map((card, i) => (
        <div
          className={`management-stat ${i === 1 ? "is-accent" : ""}`}
          key={card.label}
        >
          <div>
            <span>{card.label}</span>
            <card.icon size={19} />
          </div>
          <strong>{counts[i].data ?? "—"}</strong>
          <small>
            {counts[i].isError ? (
              <button onClick={() => void counts[i].refetch()}>
                计数加载失败，重试
              </button>
            ) : (
              card.note
            )}
          </small>
        </div>
      ))}
    </div>
  );
}
