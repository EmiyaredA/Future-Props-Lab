import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { api, unwrap } from "@platform/api/client";
import { thoughtKeys } from "../queryKeys";
import { personText, type People } from "./formatting";

const members = async () =>
  unwrap(await api.GET("/v1/account/workspaces/current/members"));

export function PersonChoices({
  label,
  multiple,
  value,
  onChange,
  people = {},
  editable,
}: {
  label: string;
  multiple: boolean;
  value: unknown;
  onChange: (value: string | string[] | null) => void;
  people?: People;
  editable: boolean;
}) {
  const directory = useQuery({
    queryKey: thoughtKeys.workspaceMembers(),
    queryFn: members,
    enabled: editable,
    staleTime: 30_000,
  });
  const options = (directory.data?.items ?? []).map((member) => ({
    value: member.user_id,
    label: member.display_name || member.username,
  }));
  const selected = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string" && value
      ? [value]
      : [];
  if (!editable) return <span>{personText(value, people) || "—"}</span>;
  if (directory.isError) return <p role="alert">无法读取当前空间成员。</p>;
  if (!multiple) {
    const current = selected[0] ?? "";
    const known = options.some((option) => option.value === current);
    return (
      <CustomSelect
        ariaLabel={label}
        value={current}
        options={[
          { value: "", label: "请选择成员" },
          ...(current && !known
            ? [
                {
                  value: current,
                  label: people[current] ?? "已离开",
                  disabled: true,
                },
              ]
            : []),
          ...options,
        ]}
        onChange={(next) => onChange(next || null)}
      />
    );
  }
  return (
    <div className="multitable-options" role="group" aria-label={label}>
      {options.map((option) => (
        <label key={option.value}>
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={(event) => {
              const next = event.target.checked
                ? [...selected, option.value]
                : selected.filter((id) => id !== option.value);
              onChange(next.length ? next : null);
            }}
          />
          {option.label}
        </label>
      ))}
      {selected
        .filter((id) => !options.some((option) => option.value === id))
        .map((id) => (
          <span key={id}>{people[id] ?? "已离开"}</span>
        ))}
    </div>
  );
}
