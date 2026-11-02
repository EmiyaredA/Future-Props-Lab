import { LoadingState } from "@shared/ui/LoadingState";
import { ResponsiveImage } from "@shared/ui/ResponsiveImage";
import { integrationKeys } from "./queryKeys";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  File,
  FileCode,
  FileText,
  Folder,
  Image as ImageIcon,
} from "lucide-react";
import {
  getSkillFiles,
  getSkillFileText,
  type Skill,
  type SkillFileEntry,
} from "@features/integrations/api";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

type TreeNode = {
  name: string;
  path: string;
  file?: SkillFileEntry;
  children: TreeNode[];
};

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((left, right) => {
      const leftFolder = left.children.length > 0;
      const rightFolder = right.children.length > 0;
      if (leftFolder !== rightFolder) return leftFolder ? 1 : -1;
      if (left.name.toLowerCase() === "skill.md") return -1;
      if (right.name.toLowerCase() === "skill.md") return 1;
      return left.name.localeCompare(right.name, "zh-CN");
    })
    .map((node) => ({ ...node, children: sortNodes(node.children) }));
}

function buildSkillFileTree(files: SkillFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let level = root;
    let accumulated = "";
    parts.forEach((part, index) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const leaf = index === parts.length - 1;
      let node = level.find((item) => item.name === part);
      if (!node) {
        node = { name: part, path: accumulated, children: [] };
        level.push(node);
      }
      if (leaf) node.file = file;
      level = node.children;
    });
  }
  return sortNodes(root);
}

function fileIcon(file: SkillFileEntry) {
  if (file.kind === "image") return ImageIcon;
  if (/\.(py|js|ts|tsx|sh|json|ya?ml|toml|css)$/i.test(file.path))
    return FileCode;
  if (file.kind === "text") return FileText;
  return File;
}

function FileTree({
  nodes,
  depth,
  selectedPath,
  collapsed,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedPath: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  return nodes.map((node) => {
    const folder = node.children.length > 0;
    if (folder) {
      const open = !collapsed.has(node.path);
      return (
        <div key={node.path}>
          <button
            type="button"
            className="skill-tree-folder"
            style={{ paddingLeft: 8 + depth * 16 }}
            aria-expanded={open}
            aria-label={node.path}
            onClick={() => onToggle(node.path)}
          >
            <ChevronRight
              aria-hidden
              className={
                open ? "skill-folder-chevron open" : "skill-folder-chevron"
              }
            />
            <Folder aria-hidden />
            <span>{node.name}</span>
          </button>
          {open ? (
            <FileTree
              nodes={node.children}
              depth={depth + 1}
              selectedPath={selectedPath}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ) : null}
          {node.file ? (
            <FileButton
              file={node.file}
              name={node.name}
              depth={depth}
              selected={selectedPath === node.file.path}
              onSelect={onSelect}
            />
          ) : null}
        </div>
      );
    }
    if (!node.file) return null;
    return (
      <FileButton
        key={node.path}
        file={node.file}
        name={node.name}
        depth={depth}
        selected={selectedPath === node.file.path}
        onSelect={onSelect}
      />
    );
  });
}

function FileButton({
  file,
  name,
  depth,
  selected,
  onSelect,
}: {
  file: SkillFileEntry;
  name: string;
  depth: number;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const Icon = fileIcon(file);
  return (
    <button
      type="button"
      className="skill-tree-file"
      style={{ paddingLeft: 8 + depth * 16 }}
      aria-current={selected ? "true" : undefined}
      aria-label={file.path}
      onClick={() => onSelect(file.path)}
    >
      <span className="skill-tree-spacer" aria-hidden />
      <Icon aria-hidden />
      <span>{name}</span>
    </button>
  );
}

function mediaPath(skill: Skill, version: string, path: string) {
  return `/v1/integrations/skills/${encodeURIComponent(skill.id)}/versions/${encodeURIComponent(version)}/files/media?path=${encodeURIComponent(path)}`;
}

export function SkillVersionBrowser({
  skill,
  version,
  onDownload,
}: {
  skill: Skill;
  version: string;
  onDownload: () => void;
}) {
  const filesQuery = useQuery({
    queryKey: integrationKeys.skillFiles(skill.id, version),
    queryFn: () => getSkillFiles(skill, version),
  });
  const files = useMemo(
    () => filesQuery.data?.files ?? [],
    [filesQuery.data?.files],
  );
  const tree = useMemo(() => buildSkillFileTree(files), [files]);
  const [selectedPath, setSelectedPath] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedPath("");
    setCollapsed(new Set());
  }, [skill.id, version]);
  useEffect(() => {
    if (!files.length) return;
    if (selectedPath && files.some((file) => file.path === selectedPath))
      return;
    const skillFile = files.find(
      (file) => file.path.toLowerCase() === "skill.md",
    );
    setSelectedPath(skillFile?.path ?? files[0]?.path ?? "");
  }, [files, selectedPath]);
  const selected = files.find((file) => file.path === selectedPath);
  const textQuery = useQuery({
    queryKey: integrationKeys.skillFileText(skill.id, version, selectedPath),
    queryFn: () => getSkillFileText(skill, version, selectedPath),
    enabled: selected?.kind === "text",
  });
  const image = useApiBlobUrl(
    selected?.kind === "image"
      ? mediaPath(skill, version, selected.path)
      : null,
  );
  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="skill-browser-wrap">
      <div className="skill-browser">
        <nav className="skill-file-tree" aria-label="Skill 文件">
          {filesQuery.isPending ? (
            <LoadingState label="正在读取文件…" variant="region" />
          ) : filesQuery.isError ? (
            <p role="alert">文件列表加载失败</p>
          ) : files.length === 0 ? (
            <p>这个版本没有可显示的文件。</p>
          ) : (
            <FileTree
              nodes={tree}
              depth={0}
              selectedPath={selectedPath}
              collapsed={collapsed}
              onToggle={toggle}
              onSelect={setSelectedPath}
            />
          )}
        </nav>
        <div className="skill-file-view">
          <header>
            <strong>{selected?.path ?? "未选择文件"}</strong>
            <span>
              {selected?.kind === "text"
                ? "纯文本 · 只读"
                : selected?.kind === "image"
                  ? "图片 · 只读"
                  : selected
                    ? "不能预览"
                    : ""}
            </span>
          </header>
          {selected?.kind === "text" && textQuery.isPending ? (
            <LoadingState label="正在读取文件…" variant="region" />
          ) : selected?.kind === "text" && textQuery.isError ? (
            <p role="alert">文件读取失败</p>
          ) : selected?.kind === "text" && textQuery.data ? (
            <pre>{textQuery.data.content}</pre>
          ) : selected?.kind === "image" && image.loading ? (
            <LoadingState label="正在读取图片…" variant="region" />
          ) : selected?.kind === "image" && image.error ? (
            <p role="alert">图片读取失败</p>
          ) : selected?.kind === "image" && image.url ? (
            <div className="skill-file-image">
              <ResponsiveImage src={image.url} alt={selected.path} />
            </div>
          ) : selected ? (
            <p className="skill-file-note">
              这个文件不能在这里预览。需要整份内容时请下载 ZIP。
            </p>
          ) : (
            <p className="skill-file-note">从左边选择一个文件。</p>
          )}
        </div>
      </div>
      <div className="skill-browser-foot">
        <span>
          {filesQuery.data ? (
            `${files.length} 个文件 · 点左边文件名查看内容 · 脚本不会被执行`
          ) : (
            <LoadingState variant="inline" label="正在读取文件…" />
          )}
        </span>
        <button type="button" className="btn" onClick={onDownload}>
          <Download aria-hidden />
          下载 ZIP
        </button>
      </div>
    </div>
  );
}
