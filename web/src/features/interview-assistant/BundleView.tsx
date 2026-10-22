import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ExternalLink, FileText } from "lucide-react";
import type { Bundle } from "./api";
import { Badge, Button } from "./ui";

function DocumentText({ children }: { children: string }) {
  return (
    <div className="ia-rich-text">
      <ReactMarkdown
        skipHtml
        allowedElements={[
          "p",
          "a",
          "strong",
          "em",
          "code",
          "ul",
          "ol",
          "li",
          "br",
        ]}
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function BundleView({ bundle }: { bundle: Bundle }) {
  const [tab, setTab] = useState("topics");
  const safeUrl = (value: string) =>
    /^https?:\/\//i.test(value) ? value : null;
  return (
    <div className="ia-bundle">
      <DocumentText>{bundle.material_summary}</DocumentText>
      <p className="field-hint">
        由 Codex
        整理；通过结构校验不代表结论已全部事实核实。请结合来源版本审阅。
      </p>
      <div className="task-tabs" role="group" aria-label="资料内容">
        {[
          ["topics", "知识资料"],
          ["evidence", "岗位与经历"],
          ["questions", "问题蓝图"],
          ["sources", "网络来源"],
          ["rubric", "评价依据"],
        ].map(([id, label]) => (
          <Button
            key={id}
            className={tab === id ? "selected" : ""}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="ia-bundle-body">
        {tab === "topics" &&
          bundle.topics.map((topic) => (
            <article key={topic.id} className="ia-document-card">
              <Badge>{topic.version || "版本未确定"}</Badge>
              <h3>{topic.title}</h3>
              <DocumentText>{topic.summary}</DocumentText>
              <DocumentText>{topic.relevance}</DocumentText>
              <ul>
                {topic.key_points.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
              <small>来源：{topic.source_ids.join(" · ")}</small>
            </article>
          ))}
        {tab === "evidence" && (
          <>
            <h3>岗位能力</h3>
            {bundle.requirements.map((item) => (
              <article key={item.id} className="ia-document-card">
                <h4>{item.capability}</h4>
                {item.evidence.map((ref, i) => (
                  <blockquote key={i}>
                    <small>
                      {ref.file_id} · {ref.location}
                    </small>
                    <p>{ref.excerpt}</p>
                  </blockquote>
                ))}
              </article>
            ))}
            <h3>简历经历</h3>
            {bundle.experiences.map((item) => (
              <article key={item.id} className="ia-document-card">
                <h4>{item.title}</h4>
                <p>{item.summary}</p>
                {item.evidence.map((ref, i) => (
                  <blockquote key={i}>
                    <small>
                      {ref.file_id} · {ref.location}
                    </small>
                    <p>{ref.excerpt}</p>
                  </blockquote>
                ))}
                {item.uncertainties.map((text, i) => (
                  <p className="field-hint" key={i}>
                    {text}
                  </p>
                ))}
              </article>
            ))}
          </>
        )}
        {tab === "questions" &&
          bundle.questions.map((question) => (
            <article key={question.id} className="ia-document-card">
              <Badge>
                {bundle.first_round.includes(question.id)
                  ? `首轮第 ${bundle.first_round.indexOf(question.id) + 1} 题`
                  : "候选追问"}
              </Badge>
              <h3>{question.question}</h3>
              <p>{question.objective}</p>
              <small>
                岗位：{question.requirement_ids.join("、")} · 经历：
                {question.experience_ids.join("、") || "通用场景"} · 来源：
                {question.source_ids.join("、")}
              </small>
              <h4>参考回答要点</h4>
              <ul>
                {question.answer_points.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
              <h4>追问方向</h4>
              <ul>
                {question.follow_ups.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        {tab === "sources" &&
          bundle.sources.map((source) => (
            <article key={source.id} className="ia-document-card">
              <small>{source.id}</small>
              <h3>
                <FileText size={17} /> {source.title}
              </h3>
              <p>
                {safeUrl(source.url) ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.url} <ExternalLink size={13} />
                  </a>
                ) : (
                  source.url
                )}
              </p>
              <small>
                检索时间：{source.retrieved_at} · 发布：
                {source.published_at || "未确定"} · 版本：
                {source.version || "未确定"}
              </small>
              <blockquote>{source.excerpt}</blockquote>
              <p>支持：{source.supports.join("、")}</p>
            </article>
          ))}
        {tab === "rubric" && (
          <>
            <p className="mock-disclaimer">
              这些是准备阶段整理的评价依据。本版复盘仍使用文字规则反馈，不会自动执行模型评分。
            </p>
            {bundle.rubric.map((dimension, i) => (
              <article key={i} className="ia-document-card">
                <h3>{dimension.dimension}</h3>
                <small>关联问题：{dimension.question_ids.join("、")}</small>
                <h4>观察要点</h4>
                <ul>
                  {dimension.answer_points.map((point, n) => (
                    <li key={n}>{point}</li>
                  ))}
                </ul>
                <h4>常见遗漏</h4>
                <ul>
                  {dimension.common_gaps.map((point, n) => (
                    <li key={n}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </>
        )}
      </div>
      <section className="ia-limitations">
        <h4>限制与待核实事项</h4>
        <ul>
          {(bundle.limitations.length
            ? bundle.limitations
            : ["未列出额外限制；请自行核对来源与经历。 "]
          ).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
