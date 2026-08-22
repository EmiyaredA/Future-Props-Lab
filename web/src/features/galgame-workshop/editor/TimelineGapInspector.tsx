import { Clock3 } from "lucide-react";
import {
  type GalgameStoryFragment,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { updateFragment } from "@features/galgame-workshop/editor/model";
import {
  formatTimecode,
  setTimelineGapEdge,
  type GalgameTimelineGap,
} from "@features/galgame-workshop/editor/timeline";
import "@features/galgame-workshop/galgameStyles";
import { TimecodeField } from "@features/galgame-workshop/editor/InspectorFieldControls";
export function TimelineGapInspector({
  gap,
  fragment,
  document,
  onDocument,
}: {
  gap: GalgameTimelineGap;
  fragment: GalgameStoryFragment;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
}) {
  const updateEdge = (edge: "start" | "end", milliseconds: number) =>
    onDocument(
      updateFragment(document, fragment.id, () =>
        setTimelineGapEdge(fragment, gap.id, edge, milliseconds),
      ),
    );
  return (
    <div className="galgame-block-inspector galgame-gap-inspector">
      <header>
        <span className="galgame-block-kind is-narration">
          <Clock3 aria-hidden />
        </span>
        <span>
          <strong>无对白区间</strong>
          <small>
            {gap.kind === "leading"
              ? "开场无对白"
              : gap.kind === "trailing"
                ? "结尾无对白"
                : "对白间歇"}
          </small>
        </span>
      </header>
      <div className="galgame-block-timing" aria-label="无对白时间范围">
        <header>
          <Clock3 aria-hidden />
          <span>
            <strong>剧情时间轴</strong>
            <small>时长 {formatTimecode(gap.endMs - gap.startMs)}</small>
          </span>
        </header>
        <div>
          <TimecodeField
            label="无对白开始时间"
            value={gap.startMs}
            disabled={!gap.previousCueId}
            onCommit={(milliseconds) => updateEdge("start", milliseconds)}
          />
          <TimecodeField
            label="无对白结束时间"
            value={gap.endMs}
            disabled={!gap.nextCueId}
            onCommit={(milliseconds) => updateEdge("end", milliseconds)}
          />
        </div>
      </div>
      <small className="galgame-gap-note">
        无对白区间不会新增 Block；剧情时钟继续推进，非循环 BGM
        结束后保持静音，舞台保留并隐藏对话框。
      </small>
    </div>
  );
}
