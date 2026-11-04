import { LoadingScene } from "@shared/ui/LoadingScene";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { DeviceCheck, Interview } from "./Interview";
import { Review } from "./Review";
import { InterviewHistory } from "./InterviewDialogs";
import { BundleView } from "./BundleView";
import { Badge, Button, Modal } from "./ui";
import { useInterviewSession } from "./useInterviewSession";
import type { Devices, InterviewSession } from "./types";

export function Practice({
  session: initial,
  devices,
  blocked,
  onExit,
  onStepChange,
}: {
  session: InterviewSession;
  devices: Devices;
  blocked: boolean;
  onExit: () => void;
  onStepChange: (step: number) => void;
}) {
  const [dialog, setDialog] = useState<
    "history" | "sources" | "end" | "reset" | "devices" | null
  >(null);
  const [retake, setRetake] = useState<InterviewSession | null>(null);
  const { state, dispatch } = useInterviewSession(
    blocked || dialog !== null,
    initial,
    devices,
  );
  const session = state.session!;
  const live = state.stage === "interview";
  useEffect(() => {
    onStepChange(live ? 2 : 3);
  }, [live, onStepChange]);
  function close() {
    setDialog(null);
    setRetake(null);
  }
  function retry(index: number, single = false) {
    setRetake({
      ...session,
      questions: single ? [session.questions[index]] : session.questions,
    });
    setDialog("devices");
  }
  return (
    <div className={live ? "interview-theme ia-practice" : "ia-practice"}>
      <div className="ia-practice-context">
        <Badge>文字练习 · 画面与评分模拟</Badge>
        <Button onClick={() => setDialog("sources")}>
          本场真实资料 · v{session.preparation?.inputVersion}
        </Button>
      </div>
      {live && (
        <Interview
          session={session}
          index={state.index}
          answers={state.answers}
          draft={state.draft}
          setDraft={(value) => dispatch({ type: "draft", value })}
          seconds={state.seconds}
          paused={state.paused}
          setPaused={() => dispatch({ type: "pause" })}
          mic={state.devices.mic}
          setMic={() => dispatch({ type: "device", device: "mic" })}
          camera={state.devices.camera}
          setCamera={() => dispatch({ type: "device", device: "camera" })}
          onSubmit={() => {
            window.speechSynthesis?.cancel();
            dispatch({ type: "submit" });
          }}
          onEnd={() => {
            window.speechSynthesis?.cancel();
            setDialog("end");
          }}
          onHistory={() => setDialog("history")}
        />
      )}
      {state.stage === "evaluating" && (
        <div className="evaluating" role="status">
          <Sparkles size={34} />
          <h1>整理这次对话里的收获</h1>
          <p>关联实际回答，生成文字规则反馈。</p>
          <LoadingScene />
          <small>模拟复盘，不进行模型评分</small>
        </div>
      )}
      {state.stage === "review" && (
        <Review
          session={session}
          answers={state.answers}
          seconds={state.seconds}
          onRetry={retry}
          onSources={() => setDialog("sources")}
          onNew={() => setDialog("reset")}
        />
      )}
      {dialog === "history" && (
        <InterviewHistory answers={state.answers} onClose={close} />
      )}
      {dialog === "sources" && session.preparation && (
        <Modal title="本场真实资料与依据" wide onClose={close}>
          <BundleView bundle={session.preparation.bundle} />
        </Modal>
      )}
      {dialog === "devices" && retake && (
        <DeviceCheck
          questionCount={retake.questions.length}
          onClose={close}
          onStart={(devices) => {
            dispatch({ type: "start", session: retake, devices });
            close();
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "end"}
        title="结束这场面试？"
        description={`已提交 ${state.answers.length} 道回答。${state.draft.trim() ? "当前输入也会保留到本次复盘。" : "根据已提交回答生成规则反馈。"}`}
        confirmLabel="结束并生成复盘"
        cancelLabel="继续面试"
        tone="primary"
        onCancel={close}
        onConfirm={() => {
          dispatch({ type: "end" });
          close();
        }}
      />
      <ConfirmDialog
        open={dialog === "reset"}
        title="开始一场新的练习？"
        description="资料已保存；当前练习回答与复盘仍仅保存在本页，请先导出需要的报告。"
        confirmLabel="新建面试"
        cancelLabel="返回复盘"
        tone="primary"
        onCancel={close}
        onConfirm={onExit}
      />
    </div>
  );
}
