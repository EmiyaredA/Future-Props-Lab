import { LoadingState } from "@shared/ui/LoadingState";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleHelp,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { Materials } from "./Prepare";
import { DeviceCheck } from "./Interview";
import { Practice } from "./Practice";
import { PreparationPanel } from "./PreparationPanel";
import { usePreparation } from "./usePreparation";
import { activeTask } from "./api";
import { Badge, Button, Modal, Select } from "./ui";
import type {
  Devices,
  InterviewSession,
  RegisterNavigationGuard,
} from "./types";
import "./assistant.css";
import "./materials.css";
import "./preparation.css";
import "./room.css";
import "./review.css";
import "./dialogs.css";
import "./preparation-live.css";

export function InterviewAssistantPage({
  registerNavigationGuard,
  scopeKey,
}: {
  registerNavigationGuard: RegisterNavigationGuard;
  scopeKey: string;
}) {
  const prep = usePreparation(scopeKey);
  const [help, setHelp] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingSession, setPendingSession] = useState<InterviewSession | null>(
    null,
  );
  const [practice, setPractice] = useState<{
    session: InterviewSession;
    devices: Devices;
  } | null>(null);
  const [practiceStep, setPracticeStep] = useState(2);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const top = useRef<HTMLElement>(null);
  const dirty = prep.dirty || !!practice || prep.busy;
  useEffect(() => {
    if (!dirty) {
      registerNavigationGuard(null);
      return;
    }
    registerNavigationGuard((next) => {
      window.speechSynthesis?.cancel();
      setPending(() => next);
      return true;
    });
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      registerNavigationGuard(null);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, registerNavigationGuard]);
  function navigate(next: () => void) {
    if (dirty) setPending(() => next);
    else next();
  }
  const step = practice ? practiceStep : prep.editing ? 0 : 1;
  useEffect(() => {
    top.current?.scrollIntoView?.({ block: "start" });
  }, [step]);
  const loading =
    prep.rooms.isPending ||
    (prep.current.isPending &&
      !prep.room &&
      prep.current.fetchStatus === "fetching");
  return (
    <section
      ref={top}
      className="interview-assistant ia-page"
      aria-label="面试助手"
    >
      <TransferFeedback progress={prep.transferProgress} />

      <header className="ia-app-header">
        <div>
          <strong>面试助手</strong>
          <Badge tone="success">
            <ShieldCheck size={14} />
            Codex 资料准备
          </Badge>
        </div>
        <Button onClick={() => setHelp(true)}>
          <CircleHelp size={16} />
          流程说明
        </Button>
      </header>
      <div className="ia-room-toolbar">
        <Select
          label="已保存的面试"
          value={prep.room?.id || "new"}
          onChange={(id) =>
            navigate(() => {
              const room = prep.rooms.data?.items.find(
                (item) => item.id === id,
              );
              if (room) {
                setPractice(null);
                prep.select(room);
              }
            })
          }
          options={[
            { value: "new", label: "新面试" },
            ...(prep.rooms.data?.items || []).map((room) => ({
              value: room.id,
              label: room.title,
            })),
          ]}
        />
        <Button
          disabled={prep.busy}
          onClick={() =>
            navigate(() => {
              setPractice(null);
              prep.newRoom();
            })
          }
        >
          <Plus size={16} />
          新建面试
        </Button>
      </div>
      <div className="flow-header">
        <span className="room-title">INTERVIEW ROOM</span>
        <ol className="flow-steps" aria-label="面试流程">
          {["提交材料", "准备资料", "正式面试", "复盘改进"].map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? "step" : undefined}
              className={i === step ? "active" : i < step ? "complete" : ""}
            >
              <span>{i < step ? <Check size={12} /> : `0${i + 1}`}</span>
              <strong>{label}</strong>
              {i < 3 && <ChevronRight size={12} />}
            </li>
          ))}
        </ol>
      </div>
      {!practice && (
        <section
          className="ia-executor-status panel"
          aria-label="Codex 连接状态"
        >
          <Badge tone={prep.executor.data?.available ? "success" : "warning"}>
            {prep.executor.data?.available
              ? `Codex ${prep.executor.data.version}`
              : "执行器未就绪"}
          </Badge>
          <p>{prep.executor.data?.message || "正在检查本机执行器…"}</p>
          <Button
            disabled={prep.executor.isFetching}
            onClick={() => void prep.executor.refetch()}
            aria-label="重新检查 Codex"
          >
            <RefreshCw size={15} />
          </Button>
        </section>
      )}
      {prep.error && (
        <p className="inline-message" role="alert">
          {prep.error}
        </p>
      )}
      {loading ? (
        <div className="evaluating" role="status">
          <LoadingState label="正在读取已保存场次…" variant="region" />
        </div>
      ) : practice ? (
        <Practice
          session={practice.session}
          devices={practice.devices}
          blocked={!!pending}
          onStepChange={setPracticeStep}
          onExit={() => {
            setPractice(null);
            prep.newRoom();
          }}
        />
      ) : prep.editing ? (
        <>
          {prep.room?.active_task_id && (
            <div className="actions">
              <Button onClick={() => prep.setEditing(false)}>
                返回已保存资料
              </Button>
            </div>
          )}
          <Materials
            form={prep.form}
            setForm={prep.setForm}
            onFile={prep.chooseFile}
            busy={prep.busy}
            available={
              !!prep.executor.data?.available && !activeTask(prep.task)
            }
            onStart={() => void prep.prepare()}
          />
        </>
      ) : prep.room ? (
        <PreparationPanel
          key={`${prep.room.id}:${prep.room.active_task_id}`}
          room={prep.room}
          scope={scopeKey}
          busy={prep.busy}
          available={!!prep.executor.data?.available}
          onCancel={() => void prep.cancel()}
          onRetry={() => void prep.prepare()}
          onEdit={() => prep.setEditing(true)}
          onStart={setPendingSession}
          onDelete={() => setDeleting(true)}
        />
      ) : null}
      <footer className="workspace-footnote">
        材料、准备任务与资料版本归当前账号保存。文字练习、音视频与复盘评分仍为模拟；练习回答刷新后清空。
      </footer>
      {pendingSession && (
        <DeviceCheck
          questionCount={pendingSession.questions.length}
          onClose={() => setPendingSession(null)}
          onStart={(devices) => {
            setPractice({ session: pendingSession, devices });
            setPendingSession(null);
          }}
        />
      )}
      {help && (
        <Modal
          title="从真实资料开始，练习一场面试"
          onClose={() => setHelp(false)}
        >
          <div className="help-list">
            <p>
              1. 提交岗位 JD、简历原件或文字。上传文件会保存为本场只读材料。
            </p>
            <p>
              2. 本机 Codex
              自动读取材料、联网搜索并交付结构化资料。页面显示实际任务进度，离开不取消后台准备。
            </p>
            <p>
              3.
              审阅来源、原文依据、六道候选题和评价维度，使用三道首轮问题开始文字练习。
            </p>
            <p>
              4.
              练习回答仅保存在当前页面。音视频为示意，复盘为文字规则反馈；需要保留请导出报告。
            </p>
          </div>
          <p className="mock-disclaimer">
            材料会交给本机 Codex
            当前配置的模型连接处理；搜索只应使用岗位与技术关键词。结构验收不等同于事实核实。
          </p>
        </Modal>
      )}
      <ConfirmDialog
        open={!!pending}
        title="放弃未保存的练习或材料？"
        description="已提交的资料和后台任务会保留；尚未提交的修改、当前练习回答及复盘会丢失。"
        confirmLabel="放弃未保存内容并继续"
        cancelLabel="留在当前页面"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const next = pending;
          setPending(null);
          next?.();
        }}
      />
      <ConfirmDialog
        open={deleting}
        title="删除本场面试资料？"
        description="将删除本场原件、输入快照和全部资料版本，无法恢复。"
        confirmLabel="删除本场资料"
        cancelLabel="保留"
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          void prep.remove();
        }}
      />
    </section>
  );
}
