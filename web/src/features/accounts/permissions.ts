import type { Workspace } from "./api";
export const roleLabels = {
  owner: "拥有者",
  admin: "工作区管理员",
  member: "协作者",
  viewer: "只读成员",
};
export const roleOptions = [
  { value: "member", label: "协作者", description: "编辑内容和调用模型" },
  {
    value: "viewer",
    label: "只读成员",
    description: "浏览内容、素材与已有结果",
  },
  {
    value: "admin",
    label: "工作区管理员",
    description: "管理配置、成员与审计",
  },
];
export function workspaceAllows(workspace: Workspace, permission: string) {
  return workspace.permission_keys?.includes(permission) ?? false;
}
