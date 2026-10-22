import { verdictNames, type Run } from "./api";
export function RecheckHistory({
  run,
  previous,
  onOpen,
}: {
  run: Run;
  previous: Run;
  onOpen: (id: string) => void;
}) {
  const issues = previous.results.filter(
    (result) => result.verdict === "failed",
  );
  return (
    <div className="acceptance-recheck-history">
      <section>
        <div className="acceptance-list-heading">
          <h3>原问题复核</h3>
          <small>{issues.length} 个原问题</small>
        </div>
        {issues.map((issue, index) => {
          const current = run.results.find(
            (result) => result.criterion_id === issue.criterion_id,
          );
          const confirmed =
            current?.verdict === "passed" &&
            run.decisions.some(
              (item) =>
                item.criterion_id === issue.criterion_id &&
                item.verdict === "passed",
            );
          const title =
            previous.snapshot.criteria.find(
              (item) => item.id === issue.criterion_id,
            )?.title ?? issue.criterion_id;
          const latest = [...run.decisions]
            .reverse()
            .find((item) => item.criterion_id === issue.criterion_id);
          const reason = [...previous.decisions]
            .reverse()
            .find((item) => item.criterion_id === issue.criterion_id)?.reason;
          return (
            <div className="acceptance-original-issue" key={issue.criterion_id}>
              <div className="acceptance-inline">
                <span className="acceptance-rule-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{title}</strong>
                <span
                  className={`acceptance-badge ${confirmed ? "passed" : "pending"}`}
                >
                  {confirmed ? "已解决" : current ? "待复核" : "未关联"}
                </span>
              </div>
              <p>
                原问题：
                {typeof reason === "string" && reason
                  ? reason
                  : issue.explanation}
              </p>
              {latest?.reason ? (
                <p>人工复核：{String(latest.reason)}</p>
              ) : (
                <small>
                  {confirmed
                    ? "已人工确认通过。"
                    : "核对问题区间并记录人工判断后更新状态。"}
                </small>
              )}
            </div>
          );
        })}
        {!issues.length && (
          <small>原记录没有未通过项，本次重新检查全部条目。</small>
        )}
      </section>
      <section>
        <h3>关联验收历史</h3>
        <table>
          <thead>
            <tr>
              <th>输出版本</th>
              <th>结论</th>
              <th>记录</th>
            </tr>
          </thead>
          <tbody>
            {[previous, run].map((item) => (
              <tr key={item.id}>
                <td>v{item.snapshot.output.version}</td>
                <td>
                  <span className={`acceptance-badge ${item.decision}`}>
                    {verdictNames[item.decision]}
                  </span>
                </td>
                <td>
                  {item.id === run.id ? (
                    "当前记录"
                  ) : (
                    <button
                      className="acceptance-text-button"
                      onClick={() => onOpen(item.id)}
                    >
                      原验收记录
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
