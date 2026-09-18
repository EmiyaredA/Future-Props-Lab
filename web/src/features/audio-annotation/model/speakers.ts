import type {
  AudioAnnotationSegment,
  AudioAnnotationSpeaker,
} from "@features/audio-annotation/types";
import {
  emotionKey,
  normalizeEmotionLabel,
} from "@features/audio-annotation/emotions";

export const SPEAKER_COLORS = [
  "#28B8A7",
  "#4C8FE8",
  "#9B62D0",
  "#E7A72F",
  "#ED7A52",
  "#D85E9D",
  "#7586E5",
  "#46B978",
];

export function segmentSpeakerIds(
  segment: Pick<AudioAnnotationSegment, "speaker_id" | "speaker_ids">,
): string[] {
  const ids = segment.speaker_ids?.length
    ? segment.speaker_ids
    : segment.speaker_id
      ? [segment.speaker_id]
      : [];
  return [...new Set(ids)];
}

export function speakerAssignment(speakerIds: string[]) {
  const ids = [...new Set(speakerIds.filter(Boolean))];
  return {
    speaker_id: ids[0] ?? null,
    speaker_ids: ids,
  };
}

export type SpeakerEmotionEntry = {
  speaker_id: string;
  emotion: string;
};

export function segmentSpeakerEmotions(
  segment: Pick<
    AudioAnnotationSegment,
    "emotion" | "speaker_emotions" | "speaker_id" | "speaker_ids"
  >,
): SpeakerEmotionEntry[] {
  if (segment.speaker_emotions?.length) {
    return segment.speaker_emotions
      .filter((item) => item.speaker_id && item.emotion?.trim())
      .map((item) => ({
        speaker_id: item.speaker_id,
        emotion: item.emotion.trim(),
      }));
  }
  const emotion = segment.emotion?.trim();
  if (!emotion) return [];
  return segmentSpeakerIds(segment).map((speakerId) => ({
    speaker_id: speakerId,
    emotion,
  }));
}

export function pruneSpeakerEmotions(
  emotions: SpeakerEmotionEntry[] | undefined,
  speakerIds: string[],
): SpeakerEmotionEntry[] {
  const allowed = new Set(speakerIds);
  return (emotions ?? []).filter((item) => allowed.has(item.speaker_id));
}

export function syncLegacyEmotion(
  speakerEmotions: SpeakerEmotionEntry[],
): string | null {
  const unique = [
    ...new Set(speakerEmotions.map((item) => item.emotion).filter(Boolean)),
  ];
  return unique.length === 1 ? unique[0]! : null;
}

export function applySpeakerEmotions(
  segment: Pick<
    AudioAnnotationSegment,
    "emotion" | "speaker_emotions" | "speaker_id" | "speaker_ids"
  >,
  targetSpeakerIds: string[],
  emotion: string | null,
): {
  speaker_emotions: SpeakerEmotionEntry[];
  emotion: string | null;
} {
  const allowed = new Set(segmentSpeakerIds(segment));
  const targets = [
    ...new Set(targetSpeakerIds.filter((id) => allowed.has(id))),
  ];
  const next = new Map(
    segmentSpeakerEmotions(segment)
      .filter((item) => allowed.has(item.speaker_id))
      .map((item) => [item.speaker_id, item.emotion] as const),
  );
  const cleaned = emotion?.trim() || null;
  for (const speakerId of targets) {
    if (cleaned) next.set(speakerId, cleaned);
    else next.delete(speakerId);
  }
  const speaker_emotions = [...next.entries()].map(([speaker_id, value]) => ({
    speaker_id,
    emotion: value,
  }));
  return {
    speaker_emotions,
    emotion: syncLegacyEmotion(speaker_emotions),
  };
}

export function assignSegmentSpeakers(
  segment: Pick<
    AudioAnnotationSegment,
    "emotion" | "speaker_emotions" | "speaker_id" | "speaker_ids"
  >,
  speakerIds: string[],
) {
  const assignment = speakerAssignment(speakerIds);
  const speaker_emotions = pruneSpeakerEmotions(
    segmentSpeakerEmotions(segment),
    assignment.speaker_ids,
  );
  return {
    ...assignment,
    speaker_emotions,
    emotion: syncLegacyEmotion(speaker_emotions),
  };
}

export function renameEmotionInSegments(
  segments: AudioAnnotationSegment[],
  from: string,
  to: string,
): AudioAnnotationSegment[] {
  const fromKey = emotionKey(from);
  const nextLabel = normalizeEmotionLabel(to);
  if (!nextLabel || fromKey === emotionKey(nextLabel)) return segments;
  return segments.map((segment) => {
    const emotions = segmentSpeakerEmotions(segment);
    if (!emotions.some((item) => emotionKey(item.emotion) === fromKey)) {
      if (segment.emotion && emotionKey(segment.emotion) === fromKey) {
        return { ...segment, emotion: nextLabel };
      }
      return segment;
    }
    const speaker_emotions = emotions.map((item) =>
      emotionKey(item.emotion) === fromKey
        ? { ...item, emotion: nextLabel }
        : item,
    );
    return {
      ...segment,
      speaker_emotions,
      emotion: syncLegacyEmotion(speaker_emotions),
    };
  });
}

export function sameSegmentSpeakers(
  left: Pick<AudioAnnotationSegment, "speaker_id" | "speaker_ids">,
  right: Pick<AudioAnnotationSegment, "speaker_id" | "speaker_ids">,
): boolean {
  const leftIds = segmentSpeakerIds(left);
  const rightIds = segmentSpeakerIds(right);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((speakerId, index) => speakerId === rightIds[index])
  );
}

export type ImportedAudioAnnotationSpeaker = {
  id: string;
  name: string;
  color?: string | null;
};

export function mergeImportedSpeakers(
  speakers: AudioAnnotationSpeaker[],
  imported: ImportedAudioAnnotationSpeaker[],
  createId: () => string = () => crypto.randomUUID(),
): AudioAnnotationSpeaker[] {
  const result = [...speakers];
  const names = new Set(
    result.map((speaker) => speaker.name.trim().toLocaleLowerCase("zh-CN")),
  );
  const ids = new Set(result.map((speaker) => speaker.id));

  for (const item of imported) {
    if (result.length >= 64) break;
    const name = item.name.trim();
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    if (!name || names.has(normalizedName)) continue;

    let id = item.id.trim() || createId();
    if (ids.has(id)) id = createId();
    while (ids.has(id)) id = createId();

    result.push({
      id,
      name,
      color:
        item.color && /^#[0-9a-f]{6}$/i.test(item.color)
          ? item.color
          : SPEAKER_COLORS[result.length % SPEAKER_COLORS.length]!,
    });
    names.add(normalizedName);
    ids.add(id);
  }

  return result;
}
