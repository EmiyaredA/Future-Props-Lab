import operations from "../../../../sdk/python/operations.json";

export function ApiOperations({ ids }: { ids: string }) {
  const rows = ids.split(",").map((id) => {
    const entry = Object.entries(operations).find(
      ([http, method]) =>
        http === id.trim() ||
        `${method.resource}.${method.method}` === id.trim(),
    );
    return { id, entry };
  });
  return (
    <div
      className="parameter-table-wrap"
      role="region"
      aria-label="API 操作，可横向滚动"
      tabIndex={0}
    >
      <table className="parameter-table">
        <thead>
          <tr>
            <th>SDK 方法</th>
            <th>HTTP 操作</th>
            <th>参考</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, entry }) => (
            <tr key={id}>
              {entry ? (
                <>
                  <td>
                    <code>
                      {entry[1].resource}.{entry[1].method}
                    </code>
                  </td>
                  <td>
                    <code>{entry[0]}</code>
                  </td>
                  <td>
                    <a
                      href={`/docs.html?page=sdk-reference-${entry[1].resource.replaceAll("_", "-")}#${entry[1].method.replaceAll("_", "-")}`}
                    >
                      查看接口
                    </a>
                  </td>
                </>
              ) : (
                <td colSpan={3} role="alert">
                  未知操作：{id}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
