import type { InterviewSession, InterviewAnswer } from "./types";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FilePenLine,
  FileText,
  Lightbulb,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { Badge, Button } from "./ui";
import { Camera } from "./Interview";
import { buildReport, formatTime, makeFeedback } from "./model";

export function Review({
  session,
  answers,
  seconds,
  onRetry,
  onSources,
  onNew,
}: {
  session: InterviewSession;
  answers: InterviewAnswer[];
  seconds: number;
  onRetry: (index: number, single?: boolean) => void;
  onSources: (index: number) => void;
  onNew: () => void;
}) {
  const [tab, setTab] = useState("feedback"),
    [selected, setSelected] = useState(0),
    [playing, setPlaying] = useState(false),
    [copied, setCopied] = useState(false),
    [exported, setExported] = useState(false);
  const feedback = makeFeedback(answers);
  const item = feedback[selected];
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setSelected((previous) => {
          if (previous >= answers.length - 1) {
            setPlaying(false);
            return previous;
          }
          return previous + 1;
        }),
      2400,
    );
    return () => clearInterval(timer);
  }, [playing, answers.length]);
  function exportReport() {
    const url = URL.createObjectURL(
      new Blob([buildReport(session, answers, seconds)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "模拟面试复盘.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setExported(true);
  }
  const resumeSuggestion = `在「${session.project}」中负责【明确个人职责】，通过【真实行动与关键取舍】，以【评估或验证方法】确认效果，取得【可核实的结果】。`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(resumeSuggestion);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <>
      <div className="page-heading review-heading">
        <div>
          <p className="eyebrow">EVERY ANSWER IS A PLACE TO GROW.</p>
          <h1>面试复盘</h1>
          <p>
            {session.role}
            <span className="meta-divider">/</span>
            <Clock3 size={14} />
            {formatTime(seconds)}
            <span className="meta-divider">/</span>已回答 {answers.length} /{" "}
            {session.questions.length} 题
          </p>
        </div>
        <div className="actions">
          <Badge tone="success">
            <Check size={13} />
            本场记录已整理
          </Badge>
          <Button onClick={exportReport}>
            <Download size={16} />
            {exported ? "再次导出报告" : "导出报告"}
          </Button>
        </div>
      </div>
      <div className="review-grid">
        <section className="panel playback-panel">
          <div className="section-title">
            <h2>回到那一刻</h2>
            <Badge>对话回放 · 模拟</Badge>
          </div>
          <div className="replay-image">
            <Camera label="示意画面 · 未录制视频" />
            <button
              className="replay-play"
              aria-label={playing ? "暂停对话回放" : "播放对话回放"}
              disabled={!answers.length}
              onClick={() => {
                if (selected === answers.length - 1) setSelected(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <div className="replay-timeline">
              <div className="replay-markers">
                {answers.map((_, index) => (
                  <button
                    key={index}
                    className={selected === index ? "selected" : ""}
                    style={{
                      left: `${10 + index * (75 / Math.max(1, answers.length - 1))}%`,
                    }}
                    aria-label={`定位第 ${index + 1} 题`}
                    onClick={() => {
                      setSelected(index);
                      setPlaying(false);
                    }}
                  />
                ))}
              </div>
              <span>
                {formatTime(item?.at || 0)} / {formatTime(seconds)}
              </span>
              <small>逐段浏览已提交回答</small>
            </div>
          </div>
          <div className="transcript-evidence" aria-live="polite">
            <span className="eyebrow">
              {item
                ? `第 ${selected + 1} 题 · ${formatTime(item.at)}`
                : "本场还没有回答"}
            </span>
            <strong>
              {item?.question || "可以再试一次，让复盘有真实依据。"}
            </strong>
            <p>{item?.text || "提前结束时，没有提交的内容不会生成评估。"}</p>
          </div>
        </section>
        <section className="panel feedback-panel">
          <div className="review-tabs" role="tablist" aria-label="复盘视图">
            {[
              { id: "feedback", label: "表现反馈", icon: MessageSquare },
              { id: "resume", label: "简历建议", icon: FilePenLine },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                id={`tab-${id}`}
                aria-controls={`panel-${id}`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next = id === "resume" ? "feedback" : "resume";
                    setTab(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }
                }}
                onClick={() => setTab(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
            className="review-tab-content"
          >
            {tab === "feedback" ? (
              <>
                <div className="feedback-intro">
                  <Lightbulb size={21} />
                  <div>
                    <h3>让下一次回答，更进一步</h3>
                    <p>点击反馈，定位到对应的问题与回答。</p>
                  </div>
                </div>
                {feedback.length ? (
                  feedback.map((entry, index) => (
                    <button
                      className={`feedback-card ${selected === index ? "selected" : ""}`}
                      key={index}
                      onClick={() => {
                        setSelected(index);
                        setPlaying(false);
                      }}
                    >
                      <div className="feedback-card-title">
                        <span>0{index + 1}</span>
                        <strong>{entry.title}</strong>
                        <Badge>{formatTime(entry.at)}</Badge>
                      </div>
                      <p>{entry.detail}</p>
                      <blockquote>
                        “{entry.excerpt}
                        {entry.text.length > 88 ? "…" : ""}”
                      </blockquote>
                      <span className="text-link">
                        查看这段回答
                        <ChevronRight size={14} />
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <MessageSquare size={30} />
                    <h3>还没有可分析的回答</h3>
                    <p>你可以重新练习，提交回答后再生成复盘。</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="feedback-intro">
                  <FilePenLine size={21} />
                  <div>
                    <h3>从经历，写到可信的贡献</h3>
                    <p>将面试中讲清楚的细节，带回简历里。</p>
                  </div>
                </div>
                <div className="resume-original">
                  <span>目前的简历摘要</span>
                  <p>{session.resume}</p>
                </div>
                <div className="resume-improved">
                  <Badge>建议表达模板</Badge>
                  <p>{resumeSuggestion}</p>
                  <Button onClick={copy}>
                    {copied ? <Check size={15} /> : <FileText size={15} />}
                    {copied ? "已复制" : "复制建议"}
                  </Button>
                </div>
                <p className="field-hint">
                  【括号】内容需要用真实经历补全，不自动生成业绩或指标。
                </p>
                <div className="resume-checks">
                  <h4>下次完善时，可以检查</h4>
                  {[
                    "是否区分个人贡献与团队结果",
                    "是否说明为什么选择这个方案",
                    "是否有可验证的依据与结果",
                  ].map((text) => (
                    <p key={text}>
                      <Check size={15} />
                      {text}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
      <div className="review-summary">
        <div>
          <Sparkles size={20} />
          <span>
            <strong>
              {answers.length
                ? "这一轮的练习，已经有了自己的依据。"
                : "先完成一次回答，再看看可以改进的地方。"}
            </strong>
            <small>
              反馈使用文本长度与关键词规则模拟；未调用模型，不包含真实音视频分析。
            </small>
          </span>
        </div>
        <Button onClick={() => onSources(0)}>
          <Search size={16} />
          查看本场依据
        </Button>
      </div>
      <div className="page-footer">
        <Button onClick={onNew}>
          <RotateCcw size={15} />
          新建一场面试
        </Button>
        <div className="actions">
          <Button
            disabled={!answers.length}
            onClick={() =>
              onRetry(Math.min(selected, session.questions.length - 1), true)
            }
          >
            只练这一题
            <ArrowRight size={16} />
          </Button>
          <Button variant="primary" onClick={() => onRetry(0)}>
            <RotateCcw size={17} />
            再练一轮
          </Button>
        </div>
      </div>
    </>
  );
}
