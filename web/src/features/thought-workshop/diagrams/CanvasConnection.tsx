import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { edgePath } from "./model";
export function CanvasConnection(props: EdgeProps) {
  return <BaseEdge id={props.id} path={edgePath(props.sourceX, props.sourceY, props.targetX, props.targetY, props.data?.style === "step", props.sourcePosition === "top" || props.sourcePosition === "bottom")} markerEnd={props.markerEnd} label={props.label} labelX={(props.sourceX+props.targetX)/2} labelY={(props.sourceY+props.targetY)/2-8} style={{stroke:"#365f62",strokeWidth:2}} />;
}
