import type { AudioSeamCandidate } from "./types";

export function VideoEditorAudioCandidateMarkers({
  candidates,
  selected,
  onSelect,
}: {
  candidates: AudioSeamCandidate[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return candidates.map((candidate, index) => (
    <button
      key={candidate.sourceInUs}
      type="button"
      className={`ve-audio-candidate-marker${selected === index ? " selected" : ""}`}
      style={{
        left: `${10 + index * 18}px`,
        top: "3px",
      }}
      aria-label={`候选接点 ${index + 1}，源时间 ${(candidate.sourceInUs / 1_000_000).toFixed(2)} 秒`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(index);
      }}
    >
      {index + 1}
    </button>
  ));
}
