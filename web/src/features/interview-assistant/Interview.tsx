import candidateImage from "./assets/candidate-demo.png";
import type { InterviewSession, InterviewAnswer, Devices } from "./types";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Captions,
  Check,
  CircleHelp,
  Clock3,
  FileText,
  History,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  Play,
  Send,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { Badge, Button, Modal } from "./ui";
import { formatTime } from "./model";

export function Camera({
  enabled = true,
  label = "我的画面",
  className = "",
}: {
  enabled?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`camera ${className}`}>
      {enabled ? (
        <img src={candidateImage} alt="虚构候选人的摄像头示意照片" />
      ) : (
        <div className="camera-off">
          <VideoOff size={30} />
          <span>摄像头已关闭</span>
        </div>
      )}
      <span className="camera-label">
        <Video size={13} />
        {label}
      </span>
      <span className="camera-demo">示意画面</span>
    </div>
  );
}

export function DeviceCheck({
  onClose,
  onStart,
  questionCount = 3,
}: {
  onClose: () => void;
  onStart: (devices: Devices) => void;
  questionCount?: number;
}) {
  const [mic, setMic] = useState(true),
    [camera, setCamera] = useState(true),
    [tested, setTested] = useState(false);
  return (
    <Modal title="先让自己进入状态" onClose={onClose} wide>
      <p className="modal-intro">
        找一个安静的地方，调整坐姿。准备好后，就从你的经历开始。
      </p>
      <div className="device-grid">
        <Camera enabled={camera} />
        <div className="device-settings">
          <Badge tone="success">模拟设备检查</Badge>
          <h3>这场对话，属于你。</h3>
          <p>
            模拟版使用示意画面与文字回答，不会访问摄像头、麦克风或录制媒体。
          </p>
          <button
            className="device-toggle"
            role="switch"
            aria-checked={mic}
            onClick={() => setMic(!mic)}
          >
            <Mic size={18} />
            <span>
              麦克风<small>{mic ? "模拟输入已开启" : "模拟输入已关闭"}</small>
            </span>
            <span className={`switch ${mic ? "on" : ""}`} />
          </button>
          <button
            className="device-toggle"
            role="switch"
            aria-checked={camera}
            onClick={() => setCamera(!camera)}
          >
            <Video size={18} />
            <span>
              摄像头<small>{camera ? "显示示意画面" : "隐藏示意画面"}</small>
            </span>
            <span className={`switch ${camera ? "on" : ""}`} />
          </button>
          <Button onClick={() => setTested(true)}>
            <AudioLines size={17} />
            {tested ? "模拟输入正常" : "测试模拟输入"}
            {tested && <Check size={15} />}
          </Button>
        </div>
      </div>
      <div className="modal-footer">
        <span>共 {questionCount} 道练习题 · 支持暂停和提前结束</span>
        <Button variant="primary" onClick={() => onStart({ mic, camera })}>
          准备好了，开始面试
          <ArrowRight size={17} />
        </Button>
      </div>
    </Modal>
  );
}

export function Interview({
  session,
  index,
  answers,
  draft,
  setDraft,
  seconds,
  paused,
  setPaused,
  mic,
  setMic,
  camera,
  setCamera,
  onSubmit,
  onEnd,
  onHistory,
}: {
  session: InterviewSession;
  index: number;
  answers: InterviewAnswer[];
  draft: string;
  setDraft: (value: string) => void;
  seconds: number;
  paused: boolean;
  setPaused: (value: boolean) => void;
  mic: boolean;
  setMic: (value: boolean) => void;
  camera: boolean;
  setCamera: (value: boolean) => void;
  onSubmit: () => void;
  onEnd: () => void;
  onHistory: () => void;
}) {
  const [captions, setCaptions] = useState(false),
    [speechStatus, setSpeechStatus] = useState("");
  const question = session.questions[index];
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, [index]);
  function speak() {
    if (
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      setSpeechStatus("此浏览器不支持朗读，可直接阅读题目。");
      return;
    }
    const voice = window.speechSynthesis
      .getVoices()
      .find(
        (item) => item.localService && item.lang.toLowerCase().startsWith("zh"),
      );
    if (!voice) {
      setSpeechStatus("当前没有可用的本机中文语音，可直接阅读题目。");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(question.title);
    utterance.voice = voice;
    utterance.lang = "zh-CN";
    utterance.rate = 0.92;
    utterance.onstart = () => setSpeechStatus("正在朗读问题…");
    utterance.onend = () => setSpeechStatus("朗读结束");
    utterance.onerror = () => setSpeechStatus("语音不可用，可直接阅读题目。");
    window.speechSynthesis.speak(utterance);
  }
  return (
    <div className="interview-layout">
      <div className="interview-top">
        <div>
          <Badge>{question.category}</Badge>
          <span>
            第 {index + 1} / {session.questions.length} 题
          </span>
        </div>
        <div>
          <span className={`live-dot ${paused ? "paused" : ""}`} />
          {paused ? "已暂停" : "面试进行中"}
          <span className="timer">
            <Clock3 size={16} />
            {formatTime(seconds)}
          </span>
          <Button
            className="icon-button"
            aria-label="查看本场对话"
            onClick={onHistory}
          >
            <History size={19} />
          </Button>
        </div>
      </div>
      <div className="interview-grid">
        <section className="question-room">
          <div className={`interviewer-emblem ${paused ? "" : "listening"}`}>
            <AudioLines size={39} strokeWidth={1.5} />
          </div>
          <p className="eyebrow">{session.role} · 模拟面试官</p>
          <h1 key={index}>{question.title}</h1>
          <div className="listening-status">
            <AudioLines size={19} />
            {paused
              ? "休息一下，准备好后继续"
              : mic
                ? "正在聆听 · 以文字模拟转写"
                : "麦克风已关闭 · 仍可输入回答"}
          </div>
          <div className="question-options">
            <Button onClick={speak} disabled={paused}>
              <Volume2 size={16} />
              朗读问题
            </Button>
            <Button
              aria-pressed={captions}
              onClick={() => setCaptions(!captions)}
            >
              <Captions size={17} />
              {captions ? "收起字幕" : "显示字幕"}
            </Button>
          </div>
          {speechStatus && (
            <p className="speech-status" role="status">
              {speechStatus}
            </p>
          )}
          {captions && <p className="caption-line">面试官：{question.title}</p>}
        </section>
        <aside className="self-view">
          <Camera enabled={camera} />
          <div className="session-note">
            <CircleHelp size={16} />
            <p>
              不用急着给出完美答案。
              <br />
              先说结论，再解释你的判断。
            </p>
          </div>
          <div className="question-progress">
            {session.questions.map((q, i) => (
              <span
                key={`${i}:${q.title}`}
                className={i < index ? "done" : i === index ? "active" : ""}
              >
                <span>{i < index ? <Check size={12} /> : `0${i + 1}`}</span>
                {q.category}
              </span>
            ))}
          </div>
        </aside>
      </div>
      <form
        className="answer-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!paused && draft.trim()) onSubmit();
        }}
      >
        <div className="answer-label">
          <label htmlFor="interview-answer">
            <FileText size={16} />
            你的回答 <span>模拟语音转写</span>
          </label>
          <Button
            type="button"
            disabled={paused}
            onClick={() => setDraft(question.sample)}
          >
            <Sparkles size={14} />
            填入示例回答
          </Button>
        </div>
        <textarea
          id="interview-answer"
          disabled={paused}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            paused
              ? "面试已暂停，继续后可输入。"
              : "在这里输入回答，体验完整对话流程…"
          }
          maxLength={6000}
        />
        <div className="answer-actions">
          <small>{draft.length} / 6000 · 回答仅用于本次演示</small>
          <Button
            type="submit"
            variant="primary"
            disabled={paused || !draft.trim()}
          >
            {index === session.questions.length - 1
              ? "提交并生成复盘"
              : "提交回答，继续"}
            <Send size={16} />
          </Button>
        </div>
      </form>
      <div className="interview-controls">
        <div className="device-controls">
          <Button
            aria-pressed={mic}
            aria-label={mic ? "关闭麦克风" : "开启麦克风"}
            onClick={() => setMic(!mic)}
          >
            {mic ? <Mic size={20} /> : <MicOff size={20} />}
            <span>
              麦克风<small>{mic ? "模拟开启" : "已关闭"}</small>
            </span>
          </Button>
          <Button
            aria-pressed={camera}
            aria-label={camera ? "关闭摄像头" : "开启摄像头"}
            onClick={() => setCamera(!camera)}
          >
            {camera ? <Video size={20} /> : <VideoOff size={20} />}
            <span>
              摄像头<small>{camera ? "示意画面" : "已关闭"}</small>
            </span>
          </Button>
        </div>
        <div className="actions">
          <Button
            onClick={() => {
              window.speechSynthesis?.cancel();
              setPaused(!paused);
            }}
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
            {paused ? "继续面试" : "暂停"}
          </Button>
          <Button variant="end-call" onClick={onEnd}>
            <PhoneOff size={18} />
            结束面试
          </Button>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        已提交 {answers.length} 道题的回答。
      </div>
    </div>
  );
}
