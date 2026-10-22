import type { InterviewInput } from "./types";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Clock3,
  FileText,
  FolderInput,
  Info,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button, Badge, Select } from "./ui";
import { example } from "./model";

export function Materials({
  form,
  setForm,
  onStart,
  onFile,
  busy,
  available,
}: {
  form: InterviewInput;
  setForm: Dispatch<SetStateAction<InterviewInput>>;
  onStart: () => void;
  onFile: (file: File | null) => void;
  busy: boolean;
  available: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  useEffect(
    () => () => {
      readVersion.current += 1;
    },
    [],
  );
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  function update(key: keyof InterviewInput, value: string) {
    if (key === "resume" || key === "filename") readVersion.current += 1;
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  async function load(file: File | undefined) {
    if (!file || busy) return;
    const version = ++readVersion.current;
    if (file.size > 10 * 1024 * 1024) {
      setMessage("文件超过 10 MB，请选择较小的文件。");
      return;
    }
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      setMessage("支持 PDF、DOCX、TXT、Markdown 文件。");
      return;
    }
    onFile(file);
    setForm((previous) => ({ ...previous, filename: file.name, resume: "" }));
    if (/\.(txt|md)$/i.test(file.name)) {
      try {
        const text = await file.text();
        if (readVersion.current !== version) return;
        setForm((previous) => ({
          ...previous,
          filename: file.name,
          resume: text.slice(0, 8000),
        }));
        setMessage(
          text.length > 8000
            ? "已读取前 8000 字，可在下方修改。"
            : "已读取文本，可在下方修改。",
        );
      } catch {
        if (readVersion.current === version)
          setMessage("文件读取失败，请重新选择或直接粘贴内容。");
      }
    } else {
      setForm((previous) => ({ ...previous, filename: file.name, resume: "" }));
      setMessage(
        "原件会交给 Codex 的文档工具读取。下方可填写补充说明，无需重复粘贴全文。",
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            A LITTLE PREPARATION. A BETTER CONVERSATION.
          </p>
          <h1>准备一场面试</h1>
          <p>从你的岗位与经历出发，把每次练习变得更有针对性。</p>
        </div>
        <Button
          disabled={busy}
          onClick={() => {
            readVersion.current += 1;
            onFile(null);
            setForm({ ...example, filename: "" });
            setMessage("已填入示例材料，你可以直接开始。");
          }}
        >
          <Sparkles size={16} />
          使用示例材料
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          readVersion.current++;
          onStart();
        }}
      >
        <fieldset className="ia-material-fields" disabled={busy}>
          <div className="materials-grid">
            <section className="panel material-panel">
              <div className="section-title">
                <span className="section-icon">
                  <FileText size={20} />
                </span>
                <h2>岗位 JD</h2>
                <Badge>面试的方向</Badge>
              </div>
              <label className="field">
                岗位名称
                <input
                  value={form.role}
                  onChange={(event) => update("role", event.target.value)}
                  placeholder="例如：AI 应用工程师"
                  maxLength={60}
                  required
                />
              </label>
              <label className="field grow">
                岗位描述
                <textarea
                  className="jd-text"
                  value={form.jd}
                  onChange={(event) => update("jd", event.target.value)}
                  placeholder="粘贴岗位职责、能力要求与技术方向…"
                  maxLength={8000}
                  required
                />
                <span className="input-count">{form.jd.length} / 8000</span>
              </label>
              <p className="field-hint">
                <Info size={14} />
                保留职责与要求，准备过程会围绕它们展开。
              </p>
            </section>
            <section className="panel material-panel">
              <div className="section-title">
                <span className="section-icon">
                  <FolderInput size={20} />
                </span>
                <h2>个人简历</h2>
                <Badge>真实的经历</Badge>
              </div>
              <input
                ref={input}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label="选择简历文件"
                accept=".pdf,.docx,.txt,.md"
                onChange={(event) => {
                  load(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className={`upload-area ${dragging ? "dragging" : ""}`}
                onClick={() => input.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  load(event.dataTransfer.files[0]);
                }}
              >
                <Upload size={24} />
                <span>点击上传，或拖拽简历至此</span>
                <small>PDF、DOCX、TXT、MD · 最大 10 MB</small>
              </button>
              {form.filename && (
                <div className="file-row">
                  <FileText size={21} className="accent" />
                  <div>
                    <strong>{form.filename}</strong>
                    <small>
                      {form.filename === example.filename
                        ? "示例文件 · 使用下方摘要"
                        : "将作为本场只读原件保存并交给 Codex"}
                    </small>
                  </div>
                  <Button
                    type="button"
                    className="icon-button"
                    aria-label="移除简历文件"
                    onClick={() => {
                      onFile(null);
                      update("filename", "");
                    }}
                  >
                    <X size={15} />
                  </Button>
                </div>
              )}
              <label className="field">
                简历摘要
                <textarea
                  className="resume-text"
                  value={form.resume}
                  onChange={(event) => update("resume", event.target.value)}
                  placeholder="第一行填写项目或经历名称，再补充职责、行动和结果。也可直接粘贴简历内容。"
                  maxLength={8000}
                  required={!form.filename}
                />
              </label>
              <p className="field-hint">
                原件交给 Codex 读取；无法解析时会提示补充文字。扫描件暂不支持
                OCR。
              </p>
            </section>
          </div>
          <div className="panel session-settings">
            <div className="setting-icon">
              <Clock3 size={20} />
            </div>
            <Select
              label="计划面试时长"
              value={form.duration}
              onChange={(value) => update("duration", value)}
              options={["15", "30", "45"].map((value) => ({
                value,
                label: `${value} 分钟`,
              }))}
            />
            <div className="setting-divider" />
            <div className="setting-icon">
              <Sparkles size={20} />
            </div>
            <Select
              label="准备助手"
              value={form.assistant}
              onChange={(value) => update("assistant", value)}
              options={[{ value: "Codex", label: "Codex" }]}
            />
            <p>
              整理岗位重点、项目追问与评估依据，
              <br />
              为本场对话准备一份专属资料。
            </p>
          </div>
          {message && (
            <p className="inline-message" role="status">
              {message}
            </p>
          )}
          <div className="page-footer">
            <p>
              <Info size={15} />
              提交后保存本场快照，由本机 Codex 处理并联网整理资料。
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy ||
                !available ||
                !form.jd.trim() ||
                (!form.resume.trim() && !form.filename) ||
                !form.role.trim()
              }
            >
              <Sparkles size={17} />
              {busy ? "正在提交…" : "调研并准备"}
              <ArrowRight size={17} />
            </Button>
          </div>
        </fieldset>
      </form>
    </>
  );
}
