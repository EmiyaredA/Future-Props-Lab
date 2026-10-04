import { useState } from "react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import type { ArticleSetting } from "./api";
export function ArticlePermissionsForm({
  value,
  onChange,
}: {
  value: ArticleSetting;
  onChange: (next: ArticleSetting) => void;
}) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"read" | "edit" | "manage">("read");
  const members = value.members ?? [];
  return (
    <div className="community-permission-form">
      <CustomSelect
        ariaLabel="文章访问范围"
        value={value.visibility ?? "public"}
        options={[
          { value: "public", label: "所有登录用户可读" },
          { value: "members", label: "仅指定成员可读" },
        ]}
        onChange={(visibility) =>
          onChange({
            ...value,
            visibility: visibility as ArticleSetting["visibility"],
          })
        }
      />
      <p className="community-meta">
        可编辑成员可以修改当前正文；可管理成员还能调整这篇文章的权限与发布状态。
      </p>
      {members.map((m) => (
        <div className="community-member-row" key={m.username}>
          <span>{m.username}</span>
          <CustomSelect
            ariaLabel={`${m.username} 的权限`}
            value={m.role}
            options={[
              { value: "read", label: "可读" },
              { value: "edit", label: "可编辑" },
              { value: "manage", label: "可管理" },
            ]}
            onChange={(next) =>
              onChange({
                ...value,
                members: members.map((item) =>
                  item.username === m.username
                    ? { ...item, role: next as typeof m.role }
                    : item,
                ),
              })
            }
          />
          <button
            className="btn"
            onClick={() =>
              onChange({
                ...value,
                members: members.filter((item) => item.username !== m.username),
              })
            }
          >
            移除
          </button>
        </div>
      ))}
      <div className="community-member-row">
        <input
          aria-label="成员账号"
          placeholder="输入准确的账号名"
          maxLength={64}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <CustomSelect
          ariaLabel="新成员权限"
          value={role}
          options={[
            { value: "read", label: "可读" },
            { value: "edit", label: "可编辑" },
            { value: "manage", label: "可管理" },
          ]}
          onChange={(value) => setRole(value as typeof role)}
        />
        <button
          className="btn"
          disabled={
            !username.trim() ||
            members.some(
              (m) =>
                m.username.toLocaleLowerCase() ===
                username.trim().toLocaleLowerCase(),
            )
          }
          onClick={() => {
            onChange({
              ...value,
              members: [...members, { username: username.trim(), role }],
            });
            setUsername("");
          }}
        >
          添加
        </button>
      </div>
    </div>
  );
}
