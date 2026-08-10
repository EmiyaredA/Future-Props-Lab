import {
  Images,
  MapPinned,
  Music2,
  UserRound,
  Users,
  Volume2,
  Waves,
} from "lucide-react";

export type TimelineTrackLabel = {
  id: string;
  label: string;
  meta?: string;
};

function TrackIcon({ id }: { id: string }) {
  if (id === "reference") return <Waves aria-hidden />;
  if (id === "scene") return <MapPinned aria-hidden />;
  if (id === "cg") return <Images aria-hidden />;
  if (id.startsWith("character:")) return <UserRound aria-hidden />;
  if (id === "bgm") return <Music2 aria-hidden />;
  if (id === "ambient") return <Waves aria-hidden />;
  if (id === "sfx") return <Volume2 aria-hidden />;
  return <Users aria-hidden />;
}

export function TimelineTrackLabels({
  lanes,
  laneHeight,
  laneTop,
}: {
  lanes: TimelineTrackLabel[];
  laneHeight: number;
  laneTop: (laneId: string) => number;
}) {
  return (
    <aside className="galgame-timeline-track-labels" aria-label="时间轴轨道">
      {lanes.map((lane) => (
        <span
          key={lane.id}
          className={
            lane.id.startsWith("character:")
              ? "galgame-timeline-character-child"
              : undefined
          }
          style={{
            top: `${laneTop(lane.id)}px`,
            height: `${laneHeight}px`,
          }}
        >
          <TrackIcon id={lane.id} />
          {lane.label}
          {lane.meta ? <em>{lane.meta}</em> : null}
        </span>
      ))}
    </aside>
  );
}
