import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Focus,
  Search,
} from "lucide-react";
import { applyHumanTemplate, makeBone, makeDeformer } from "./model";
import type { CharacterDocument, Deformer, Part } from "./types";
import type { Edit } from "./Inspector";

export function ObjectTree({
  doc,
  selected,
  onSelect,
  edit,
  readOnly,
  soloPartId,
  onSoloPart,
}: {
  doc: CharacterDocument;
  selected: string;
  onSelect: (id: string) => void;
  edit: Edit;
  readOnly: boolean;
  soloPartId: string | null;
  onSoloPart: (id: string | null) => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const matches = query.trim().toLocaleLowerCase();
  const toggle = (key: string) =>
    setFolded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const disclosure = (key: string, name: string) => (
    <button
      aria-label={`${folded.has(key) ? "展开" : "折叠"}${name}`}
      aria-expanded={!folded.has(key)}
      onClick={() => toggle(key)}
    >
      {folded.has(key) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
    </button>
  );
  const row = (node: Part | Deformer, depth: number): ReactNode => (
    <div key={node.id}>
      <div
        className={`l2-tree-row ${selected === node.id ? "selected" : ""}`}
        style={{ paddingLeft: depth * 12 }}
      >
        {"kind" in node && disclosure(node.id, node.name)}
        <button
          className="l2-tree-name"
          aria-pressed={selected === node.id}
          onClick={() => onSelect(node.id)}
        >
          <span>
            {"kind" in node ? (node.kind === "warp" ? "▦" : "⟳") : "◇"}
          </span>
          <span>{node.name}</span>
        </button>
        {"vertices" in node && (
          <>
            <button
              aria-label={`${soloPartId === node.id ? "退出独显" : "独显"}${node.name}`}
              aria-pressed={soloPartId === node.id}
              title="仅在画布中显示此图层，不修改工程可见性"
              onClick={() =>
                onSoloPart(soloPartId === node.id ? null : node.id)
              }
            >
              <Focus size={13} />
            </button>
            <button
              disabled={readOnly}
              aria-label={`${node.visible ? "隐藏" : "显示"}${node.name}`}
              onClick={() =>
                edit((d) => {
                  d.parts.find((p) => p.id === node.id)!.visible =
                    !node.visible;
                })
              }
            >
              {node.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button
              disabled={readOnly}
              aria-label={`${node.locked ? "解锁" : "锁定"}${node.name}`}
              onClick={() =>
                edit((d) => {
                  d.parts.find((p) => p.id === node.id)!.locked = !node.locked;
                })
              }
            >
              {node.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
          </>
        )}
      </div>
      {"kind" in node && !folded.has(node.id) && children(node.id, depth + 1)}
    </div>
  );
  const groups = (
    parts: Part[],
    parent: string,
    depth: number,
    path: string[] = [],
  ): ReactNode => {
    const direct: Part[] = [],
      nested = new Map<string, Part[]>();
    for (const part of parts) {
      const segments = part.group.split("/").filter(Boolean);
      const name = segments[path.length];
      if (!name) direct.push(part);
      else nested.set(name, [...(nested.get(name) ?? []), part]);
    }
    return (
      <>
        {[...nested].map(([name, members]) => {
          const next = [...path, name],
            key = `group:${parent}:${next.join("/")}`;
          return (
            <div key={key}>
              <div className="l2-tree-row" style={{ paddingLeft: depth * 12 }}>
                {disclosure(key, name)}
                <span>{name}</span>
              </div>
              {!folded.has(key) && groups(members, parent, depth + 1, next)}
            </div>
          );
        })}
        {direct.map((p) => row(p, depth))}
      </>
    );
  };
  function children(parent: string | null, depth: number): ReactNode {
    // Documents are validated as acyclic; this also bounds rendering of malformed client state.
    if (depth > doc.deformers.length + 1) return null;
    return (
      <>
        {doc.deformers
          .filter((d) => (d.parentId ?? null) === parent)
          .map((d) => row(d, depth))}
        {groups(
          doc.parts.filter((p) => (p.parentId ?? null) === parent),
          parent ?? "root",
          depth,
        )}
      </>
    );
  }
  return (
    <>
      <div className="l2-panel-heading">
        <h2>部件与变形器</h2>
        <span>{doc.parts.length}</span>
      </div>
      <div className="l2-tree-actions">
        {(["rotation", "warp"] as const).map((kind) => (
          <button
            key={kind}
            title={kind === "rotation" ? "新建旋转变形器" : "新建曲面变形器"}
            aria-label={kind === "rotation" ? "新建旋转变形器" : "新建曲面变形器"}
            disabled={readOnly}
            onClick={() =>
              edit((d) => {
                const node = makeDeformer(d, kind);
                d.deformers.push(node);
                onSelect(node.id);
              })
            }
          >
            <Plus size={13} />
            {kind === "rotation" ? "旋转" : "曲面"}
          </button>
        ))}
        <button
          title="新建骨骼"
          disabled={readOnly}
          onClick={() =>
            edit((d) => {
              const parent = d.bones.find((bone) => bone.id === selected);
              const bone = makeBone(d, "新骨骼", parent?.id ?? null);
              d.bones.push(bone);
              onSelect(bone.id);
            })
          }
        >
          <Plus size={13} />
          骨骼
        </button>
        <button
          title="建立人形半身骨架"
          disabled={readOnly || !!doc.bones.length}
          onClick={() => edit(applyHumanTemplate)}
        >
          人形
        </button>
      </div>
      <label className="l2-tree-search">
        <Search size={13} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索图层、骨骼、变形器"
          aria-label="搜索角色对象"
        />
      </label>
      <div className="l2-object-list" aria-label="角色对象层级">
        {matches ? (
          <>
            {doc.bones.filter((item) => item.name.toLocaleLowerCase().includes(matches)).map((bone) => (
              <div className={`l2-tree-row ${selected === bone.id ? "selected" : ""}`} key={bone.id}>
                <button className="l2-tree-name" onClick={() => onSelect(bone.id)}>♢ {bone.name}</button>
              </div>
            ))}
            {[...doc.deformers, ...doc.parts]
              .filter((item) => item.name.toLocaleLowerCase().includes(matches))
              .map((item) => row(item, 0))}
            {![...doc.bones, ...doc.deformers, ...doc.parts].some((item) => item.name.toLocaleLowerCase().includes(matches)) && (
              <p className="l2-hint">没有匹配对象</p>
            )}
          </>
        ) : (
          <>
        {doc.bones.length > 0 && (
          <div className="l2-panel-heading">
            <h2>骨骼</h2>
            <span>{doc.bones.length}</span>
          </div>
        )}
        {doc.bones.map((bone) => {
          let depth = 0;
          let parent = bone.parentId;
          while (parent && depth < doc.bones.length) {
            depth++;
            parent =
              doc.bones.find((item) => item.id === parent)?.parentId ?? null;
          }
          return (
            <div
              className={`l2-tree-row ${selected === bone.id ? "selected" : ""}`}
              key={bone.id}
              style={{ paddingLeft: depth * 12 }}
            >
              <button
                className="l2-tree-name"
                aria-pressed={selected === bone.id}
                onClick={() => onSelect(bone.id)}
              >
                <span>♢</span>
                <span>{bone.name}</span>
              </button>
            </div>
          );
        })}
        {doc.bones.length > 0 && <hr />}
        {children(null, 0)}
          </>
        )}
      </div>
      {!doc.parts.length && (
        <p className="l2-hint">使用顶部“导入素材”添加角色图层。</p>
      )}
    </>
  );
}
