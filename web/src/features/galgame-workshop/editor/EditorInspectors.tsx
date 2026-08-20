import { BlockInspectorView } from "@features/galgame-workshop/editor/BlockInspectorView";
import { useBlockInspectorController } from "@features/galgame-workshop/editor/useBlockInspectorController";
export { TimelineGapInspector } from "@features/galgame-workshop/editor/TimelineGapInspector";
export {
  Field,
  ChapterCast,
  FragmentOverviewInspector,
} from "@features/galgame-workshop/editor/BlockInspectorView";
type Props = Parameters<typeof useBlockInspectorController>[0];
export function BlockInspector(props: Props) {
  return <BlockInspectorView model={useBlockInspectorController(props)} />;
}
