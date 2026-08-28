import {
  BarChart3,
  Film,
  Image,
  Mic2,
  Music2,
  UserRound,
  Volume2,
} from "lucide-react";
import { type GalgameStoryProject } from "@features/galgame-workshop/api";
import { AssetOverviewWorkspace } from "@features/galgame-workshop/editor/AssetOverviewWorkspace";
import { CharacterWorkspace } from "@features/galgame-workshop/editor/CharacterWorkspace";
import { SoundWorkspace } from "@features/galgame-workshop/editor/SoundWorkspace";
import { VisualWorkspace } from "@features/galgame-workshop/editor/VisualWorkspace";
import { VideoWorkspace } from "@features/galgame-workshop/editor/VideoWorkspace";
import { type AssetSection } from "@features/galgame-workshop/editor/model";

const SECTIONS = [
  { id: "characters", label: "角色", icon: UserRound, group: "游戏数据" },
  { id: "scenes", label: "场景", icon: Image, group: "游戏数据" },
  { id: "bgm", label: "BGM", icon: Music2, group: "音频" },
  { id: "sfx", label: "音效", icon: Volume2, group: "音频" },
  { id: "voice", label: "语音", icon: Mic2, group: "音频" },
  { id: "video", label: "视频素材", icon: Film, group: "游戏数据" },
  { id: "overview", label: "资源总览", icon: BarChart3, group: "资源管理" },
] satisfies Array<{
  id: AssetSection;
  label: string;
  icon: typeof BarChart3;
  group: "游戏数据" | "音频" | "资源管理";
}>;

export function AssetCenter({
  projectId,
  document,
  section,
  visualSection,
  focusVisual,
  onFocusVisualHandled,
  focusCharacterId,
  onSection,
  onVisualSection,
  onDocument,
  onCommitDocument,
  onRepairMissingAsset,
  onUpgradePortraitSizes,
  onNotice,
  onCharacter,
  onLocate,
  storyRevision,
}: {
  projectId: string;
  document: GalgameStoryProject;
  section: AssetSection;
  visualSection: "scenes" | "cgs";
  focusVisual?: { kind: "scene" | "cg"; id: string };
  onFocusVisualHandled?: () => void;
  focusCharacterId?: string;
  onSection: (section: AssetSection) => void;
  onVisualSection: (section: "scenes" | "cgs") => void;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onRepairMissingAsset: (
    storyAssetId: string,
    replacementFileId: string,
  ) => Promise<boolean>;
  onUpgradePortraitSizes: () => Promise<boolean>;
  onNotice: (message: string) => void;
  onCharacter: (characterId: string) => void;
  onLocate: (
    chapterId: string | undefined,
    fragmentId: string,
    blockId: string,
  ) => void;
  storyRevision: number;
}) {
  const locate = (fragmentId: string, blockId: string) =>
    onLocate(undefined, fragmentId, blockId);
  const sectionCount = (sectionId: AssetSection) => {
    if (sectionId === "characters") return document.characters?.length ?? 0;
    if (sectionId === "scenes")
      return (document.scenes?.length ?? 0) + (document.cgs?.length ?? 0);
    if (sectionId === "overview") return document.assets?.length ?? 0;
    if (sectionId === "video")
      return (document.assets ?? []).filter((asset) => asset.type === "video")
        .length;
    const roles =
      sectionId === "bgm"
        ? ["backgroundMusic"]
        : sectionId === "voice"
          ? ["voiceLine", "voiceSample"]
          : ["soundEffect", "ambientSound"];
    return (document.assets ?? []).filter(
      (asset) => asset.type === "audio" && roles.includes(asset.role),
    ).length;
  };
  return (
    <div className="galgame-asset-center">
      <aside>
        <header>
          <small>PROJECT</small>
          <strong>资产中心</strong>
        </header>
        {(["游戏数据", "音频", "资源管理"] as const).map((group) => (
          <section key={group} className="galgame-asset-nav-group">
            <small>{group}</small>
            {SECTIONS.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.label}
                  className={`${section === item.id ? "active" : ""} is-${item.id}`}
                  onClick={() => onSection(item.id)}
                >
                  <Icon aria-hidden /> <span>{item.label}</span>
                  <em>{sectionCount(item.id)}</em>
                </button>
              );
            })}
          </section>
        ))}
      </aside>
      <main>
        {section === "overview" ? (
          <AssetOverviewWorkspace
            projectId={projectId}
            document={document}
            onNotice={onNotice}
            onLocate={onLocate}
            onRepairMissingAsset={onRepairMissingAsset}
          />
        ) : section === "video" ? (
          <VideoWorkspace
            projectId={projectId}
            document={document}
            onDocument={onDocument}
            onNotice={onNotice}
            onLocate={locate}
          />
        ) : section === "characters" ? (
          <CharacterWorkspace
            projectId={projectId}
            document={document}
            onDocument={onDocument}
            onCommitDocument={onCommitDocument}
            onNotice={onNotice}
            focusCharacterId={focusCharacterId}
            onLocate={locate}
            onUpgradePortraitSizes={onUpgradePortraitSizes}
          />
        ) : section === "scenes" ? (
          <VisualWorkspace
            projectId={projectId}
            document={document}
            onDocument={onDocument}
            onNotice={onNotice}
            section={visualSection}
            onSection={onVisualSection}
            focusVisual={focusVisual}
            onFocusVisualHandled={onFocusVisualHandled}
            onLocate={locate}
          />
        ) : (
          <SoundWorkspace
            projectId={projectId}
            document={document}
            onDocument={onDocument}
            onCommitDocument={onCommitDocument}
            onNotice={onNotice}
            onCharacter={onCharacter}
            onLocate={locate}
            initialRole={
              section === "bgm"
                ? "backgroundMusic"
                : section === "voice"
                  ? "voiceLine"
                  : "soundEffect"
            }
            storyRevision={storyRevision}
          />
        )}
      </main>
    </div>
  );
}
