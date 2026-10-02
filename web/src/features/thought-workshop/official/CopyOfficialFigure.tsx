import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { listKnowledge } from "../knowledgeApi";
import { createNote } from "../api";
import { thoughtKeys } from "../queryKeys";
import type { OfficialFigureData } from "./OfficialFigure";
export function CopyOfficialFigure({
  figure,
  sourcePath,
  onClose,
  onCreated,
}: {
  figure: OfficialFigureData;
  sourcePath: string;
  onClose: () => void;
  onCreated: (library: string, note: string) => void;
}) {
  const client = useQueryClient(),
    inFlight = useRef(false);
  const [returnFocus] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  const [project, setProject] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const projects = useQuery({
    queryKey: thoughtKeys.projects(),
    queryFn: ({ signal }) => listKnowledge("", false, signal),
  });
  const submit = async () => {
    if (inFlight.current || !project) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const note = await createNote({
        knowledge_base_id: project,
        parent_id: null,
        title:
          figure.type === "canvas" ? figure.scene.title : "官方 UML 图副本",
        schema_version: 2,
        tags: [],
        pinned: false,
        favorite: false,
        document: {
          type: "doc",
          content: [
            {
              type: figure.type,
              attrs:
                figure.type === "canvas"
                  ? { scene: structuredClone(figure.scene) }
                  : { source: figure.source },
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "来源：官方技术原理",
                  marks: [{ type: "link", attrs: { href: sourcePath } }],
                },
              ],
            },
          ],
        },
      });
      void client.invalidateQueries({ queryKey: thoughtKeys.projectLists() });
      void client.invalidateQueries({
        queryKey: thoughtKeys.directory(project),
      });
      onCreated(project, note.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "创建失败；请先确认是否已生成副本，再决定重试。",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="diagram-overlay" />
        <Dialog.Content
          className="official-copy-dialog"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(
              () => returnFocus?.isConnected && returnFocus.focus(),
            );
          }}
        >
          <Dialog.Title>复制到个人笔记</Dialog.Title>
          <p>选择目标知识库，创建可编辑的图表副本。</p>
          <CustomSelect
            ariaLabel="目标知识库"
            value={project}
            options={[
              { value: "", label: "请选择知识库" },
              ...(projects.data || []).map((p) => ({
                value: p.id,
                label: p.title,
              })),
            ]}
            onChange={setProject}
          />
          {projects.isSuccess && !projects.data.length && (
            <p>请先返回所有知识库创建个人知识库。</p>
          )}
          {(error || projects.error) && (
            <p role="alert">{error || projects.error?.message}</p>
          )}
          <div className="diagram-toolbar">
            <button className="btn" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy || !project}
              onClick={() => void submit()}
            >
              {busy ? "正在创建…" : "创建副本"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
