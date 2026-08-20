import type {
  GalgameStoryCharacter,
  GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { characterExpressionAssetId } from "@features/galgame-workshop/editor/richText";
import { StoryAssetImage } from "@features/galgame-workshop/editor/StoryAssetImage";
import { characterThumbnailCropStyle } from "@features/galgame-workshop/editor/characterThumbnail";

export function CharacterAvatar({
  character,
  document,
}: {
  character: GalgameStoryCharacter;
  document: GalgameStoryProject;
}) {
  const expression = (character.expressions ?? []).find(
    (item) => item.id === character.defaultExpressionId,
  );
  const portraitAssetId = characterExpressionAssetId(
    character,
    character.defaultExpressionId,
    undefined,
  );
  const asset = (document.assets ?? []).find(
    (item) => item.id === portraitAssetId,
  );
  return (
    <span
      className="galgame-character-avatar"
      style={characterThumbnailCropStyle(expression)}
    >
      <StoryAssetImage
        fileId={asset?.fileId}
        alt=""
        fallback={<b>{character.name.slice(0, 1) || "角"}</b>}
      />
    </span>
  );
}
