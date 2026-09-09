import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReadOnlyCollection, ReadOnlyPage } from "@shared/ui/ReadOnlyPage";
import { ReadOnlyMedia } from "@shared/ui/ReadOnlyMedia";
import {
  getModelTestConversations,
  getModelTestConversation,
  getModelTestGenerationTasks,
  getModelTestTranscriptionTasks,
} from "./api";
import { modelQueryKeys } from "./queryKeys";
export function ReadOnlyModels() {
  const [id, setId] = useState<string | null>(null);
  const [tab, setTab] = useState("conversations");
  const conversations = useQuery({
    queryKey: modelQueryKeys.conversations,
    queryFn: getModelTestConversations,
  });
  const conversation = useQuery({
    queryKey: modelQueryKeys.conversation(id),
    queryFn: () => getModelTestConversation(id!),
    enabled: !!id,
  });
  const generation = useQuery({
    queryKey: modelQueryKeys.generationTasks(""),
    queryFn: () => getModelTestGenerationTasks(),
    enabled: tab === "generation",
  });
  const transcription = useQuery({
    queryKey: modelQueryKeys.transcriptionTasks(""),
    queryFn: () => getModelTestTranscriptionTasks(),
    enabled: tab === "transcription",
  });
  return (
    <ReadOnlyPage
      title={conversation.data?.title || "模型测试结果"}
      onBack={id ? () => setId(null) : undefined}
      error={
        conversations.error ||
        conversation.error ||
        generation.error ||
        transcription.error
      }
    >
      <div className="button-row">
        {[
          ["conversations", "对话记录"],
          ["generation", "图片与视频"],
          ["transcription", "语音转写"],
        ].map(([value, label]) => (
          <button
            className={`btn ${tab === value ? "primary" : ""}`}
            key={value}
            onClick={() => {
              setTab(value);
              setId(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "conversations" ? (
        id ? (
          conversation.data?.messages.map((m) => (
            <article key={m.id}>
              <strong>{m.role === "user" ? "用户" : "模型"}</strong>
              <p>{m.content}</p>
              {m.attachments?.map((asset) => (
                <ReadOnlyMedia
                  key={asset.id}
                  path={`/v1/model-test/conversations/${id}/attachments/${asset.id}/content`}
                  kind="image"
                  name={asset.original_filename}
                />
              ))}
              {m.error_message ? <p>{m.error_message}</p> : null}
            </article>
          ))
        ) : (
          <ReadOnlyCollection
            items={conversations.data?.items || []}
            onOpen={setId}
          />
        )
      ) : null}
      {tab === "generation"
        ? generation.data?.items.map((task) => (
            <article key={task.id}>
              <h2>{task.model_slug}</h2>
              <p>{task.status}</p>
              {task.result_available ? (
                <ReadOnlyMedia
                  path={`/v1/model-test/generation-tasks/${task.id}/content`}
                  kind={task.kind === "image" ? "image" : "video"}
                  name={task.result_filename || task.id}
                />
              ) : (
                <p>暂无可播放的结果。</p>
              )}
            </article>
          ))
        : null}
      {tab === "transcription"
        ? transcription.data?.items.map((task) => (
            <article key={task.id}>
              <h2>{task.model_slug}</h2>
              <p>{task.result_text}</p>
            </article>
          ))
        : null}
    </ReadOnlyPage>
  );
}
