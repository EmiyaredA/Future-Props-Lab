import { Modal } from "./ui";
import { formatTime } from "./model";
import type { InterviewAnswer } from "./types";

export function InterviewHistory({
  answers,
  onClose,
}: {
  answers: InterviewAnswer[];
  onClose: () => void;
}) {
  return (
    <Modal title="本场对话历史" onClose={onClose} wide>
      {answers.length ? (
        answers.map((answer, i) => (
          <article className="ia-document-card" key={i}>
            <small>
              {formatTime(answer.at)} · {answer.category}
            </small>
            <h3>{answer.question}</h3>
            <p>{answer.text}</p>
          </article>
        ))
      ) : (
        <p>尚未提交回答。当前输入会在提交或结束面试时关联到题目。</p>
      )}
    </Modal>
  );
}
