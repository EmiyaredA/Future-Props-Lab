import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReadOnlyCollection } from "@shared/ui/ReadOnlyPage";
import { ReadOnlyMedia } from "@shared/ui/ReadOnlyMedia";
import {
  getVisualAssistantConversations,
  getVisualAssistantConversation,
} from "./api";
import { visualWorkshopQueryKeys } from "./queryKeys";
export function ReadOnlyVisualConversation({
  projectId,
}: {
  projectId: string;
}) {
  const [id, setId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: visualWorkshopQueryKeys.assistantConversations(projectId),
    queryFn: () => getVisualAssistantConversations(projectId),
  });
  const detail = useQuery({
    queryKey: visualWorkshopQueryKeys.assistantConversation(projectId, id),
    queryFn: () => getVisualAssistantConversation(projectId, id!),
    enabled: !!id,
  });
  return (
    <section>
      <h2>助手对话记录</h2>
      {list.error || detail.error ? (
        <p role="alert">对话记录无法加载。</p>
      ) : null}
      {id ? (
        <>
          <button className="btn small" onClick={() => setId(null)}>
            返回对话列表
          </button>
          <h3>{detail.data?.title}</h3>
          {detail.data?.messages?.map((message) => (
            <article key={message.id}>
              <strong>{message.role === "user" ? "用户" : "助手"}</strong>
              <p>{message.content}</p>
              {message.assets?.map((asset) => (
                <ReadOnlyMedia
                  key={asset.id}
                  path={`/v1/files/${asset.id}/content`}
                  kind={asset.mime_type.split("/")[0]}
                  name={asset.display_name}
                />
              ))}
            </article>
          ))}
        </>
      ) : (
        <ReadOnlyCollection items={list.data?.items || []} onOpen={setId} />
      )}
    </section>
  );
}
