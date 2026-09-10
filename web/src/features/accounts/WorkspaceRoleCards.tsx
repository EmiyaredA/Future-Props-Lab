import { Crown, ShieldCheck, Pencil, Eye, Check } from "lucide-react";
import type { Workspace } from "./api";
import { roleLabels } from "./permissions";

const roles = [
  {
    key: "owner",
    Icon: Crown,
    description: "维护整个工作空间，负责成员与管理权限。",
    groups: [
      ["内容与模型", "浏览、编辑内容和素材，调用模型。"],
      ["配置与治理", "管理模型配置、集成、空间设置与审计。"],
      ["成员与授权", "管理成员，并授予或撤销工作区管理员。"],
    ],
  },
  {
    key: "admin",
    Icon: ShieldCheck,
    description: "管理空间配置与协作，维护日常运行。",
    groups: [
      ["内容与模型", "浏览、编辑内容和素材，调用模型。"],
      ["配置与治理", "管理配置与空间设置，查看调用日志和审计。"],
      ["成员与授权", "管理协作者与只读成员，不能调整拥有者或管理员。"],
    ],
  },
  {
    key: "member",
    Icon: Pencil,
    description: "参与内容创作，使用空间中的模型能力。",
    groups: [
      ["内容与素材", "浏览、编辑、上传、删除内容与素材。"],
      ["模型使用", "调用模型并生成内容。"],
      ["管理边界", "不能管理空间配置、成员或审计。"],
    ],
  },
  {
    key: "viewer",
    Icon: Eye,
    description: "查看空间内容与已有结果。",
    groups: [
      ["内容浏览", "浏览内容、素材与已有结果。"],
      ["操作边界", "不能编辑、生成内容或调用模型。"],
      ["管理边界", "不能管理空间配置、成员或审计。"],
    ],
  },
] as const;

export function WorkspaceRoleCards({ workspace }: { workspace: Workspace }) {
  return (
    <>
      <div className="workspace-role-cards">
        {roles.map(({ key, Icon, description, groups }) => (
          <article
            key={key}
            className={`workspace-role-card${workspace.role === key ? " is-current" : ""}`}
          >
            <header>
              <span className="workspace-role-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <div>
                <h3>{roleLabels[key]}</h3>
                <span className="workspace-role-kind">固定角色</span>
              </div>
              {workspace.role === key ? (
                <span className="workspace-current-role">
                  <Check size={13} aria-hidden="true" />
                  当前角色
                </span>
              ) : null}
            </header>
            <p>{description}</p>
            <dl>
              {groups.map(([title, copy]) => (
                <div key={title}>
                  <dt>{title}</dt>
                  <dd>{copy}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      <p className="workspace-role-note">
        平台管理员可管理全部空间。工作区管理员只能管理协作者和只读成员，不能修改自身、拥有者或其他管理员的角色。公开访客仅能查看允许公开的内容。
      </p>
    </>
  );
}
