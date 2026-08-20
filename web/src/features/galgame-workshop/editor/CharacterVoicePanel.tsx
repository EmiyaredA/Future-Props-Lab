import { FolderOpen, Mic2, Trash2, Upload, Volume2 } from "lucide-react";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";
import type { CharacterWorkspaceViewModel } from "@features/galgame-workshop/editor/CharacterWorkspaceView";
export function CharacterVoicePanel({
  model,
}: {
  model: CharacterWorkspaceViewModel;
}) {
  const {
    voiceFileInput,
    setVoicePickerOpen,
    setVoicePickerSource,
    selectedCharacter,
    updateCharacter,
    voiceUpload,
    voiceSampleAsset,
  } = model;
  return (
    <div className="galgame-character-voice-form">
      <section>
        <header>
          <span>
            <Mic2 aria-hidden />
          </span>
          <span>
            <strong>角色声线</strong>
            <small>记录配音选角资料和试听样本。</small>
          </span>
        </header>
        <label className="galgame-field">
          <span>声线名称</span>
          <input
            value={selectedCharacter.voiceProfile?.name ?? "默认声线"}
            onChange={(event) =>
              updateCharacter(selectedCharacter.id, (character) => ({
                ...character,
                voiceProfile: {
                  name: event.target.value,
                  language: character.voiceProfile?.language ?? "zh-CN",
                  description: character.voiceProfile?.description ?? "",
                  sampleAssetId: character.voiceProfile?.sampleAssetId ?? null,
                },
              }))
            }
          />
        </label>
        <label className="galgame-field">
          <span>语言</span>
          <input
            value={selectedCharacter.voiceProfile?.language ?? "zh-CN"}
            onChange={(event) =>
              updateCharacter(selectedCharacter.id, (character) => ({
                ...character,
                voiceProfile: {
                  name: character.voiceProfile?.name ?? "默认声线",
                  language: event.target.value,
                  description: character.voiceProfile?.description ?? "",
                  sampleAssetId: character.voiceProfile?.sampleAssetId ?? null,
                },
              }))
            }
          />
        </label>
        <label className="galgame-field">
          <span>声线描述</span>
          <textarea
            placeholder="例如：冷静、偏低沉，句尾略带气声…"
            value={selectedCharacter.voiceProfile?.description ?? ""}
            onChange={(event) =>
              updateCharacter(selectedCharacter.id, (character) => ({
                ...character,
                voiceProfile: {
                  name: character.voiceProfile?.name ?? "默认声线",
                  language: character.voiceProfile?.language ?? "zh-CN",
                  description: event.target.value,
                  sampleAssetId: character.voiceProfile?.sampleAssetId ?? null,
                },
              }))
            }
          />
        </label>
      </section>
      <section className="galgame-character-voice-sample">
        <header>
          <strong>试听样本</strong>
          <small>仅用于选角参考，不会自动绑定到对白。</small>
        </header>
        {voiceSampleAsset ? (
          <StoryAudioPreview
            fileId={voiceSampleAsset.fileId}
            label={voiceSampleAsset.label}
          />
        ) : (
          <div className="galgame-character-voice-empty">
            <Volume2 aria-hidden />
            <strong>尚未添加试听样本</strong>
          </div>
        )}
        <div>
          <button type="button" onClick={() => voiceFileInput.current?.click()}>
            <Upload aria-hidden /> 上传样本
          </button>
          <button
            type="button"
            onClick={() => {
              setVoicePickerSource("library");
              setVoicePickerOpen(true);
            }}
          >
            <FolderOpen aria-hidden /> 从文件库选择
          </button>
          {voiceSampleAsset ? (
            <button
              type="button"
              className="danger"
              onClick={() =>
                updateCharacter(selectedCharacter.id, (character) => ({
                  ...character,
                  voiceProfile: character.voiceProfile
                    ? {
                        ...character.voiceProfile,
                        sampleAssetId: null,
                      }
                    : null,
                }))
              }
            >
              <Trash2 aria-hidden /> 移除
            </button>
          ) : null}
        </div>
        <input
          ref={voiceFileInput}
          hidden
          type="file"
          accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) voiceUpload.mutate(file);
          }}
        />
      </section>
    </div>
  );
}
