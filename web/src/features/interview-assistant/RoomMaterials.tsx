import {
  assistantElementSource,
  useAssistantElements,
} from "@platform/assistantElements";
import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { Room } from "./api";
import { Button } from "./ui";

export function RoomMaterials({ room }: { room: Room }) {
  const [selectedMaterial, selectMaterial] = useState<string>();
  useAssistantElements(
    assistantElementSource(
      {
        resource: "interview",
        projectId: room.id,
        application: "面试助手",
        locate: ({ element_id }) => {
          if (!room.materials.some((item) => item.id === element_id))
            return false;
          selectMaterial(element_id);
          return true;
        },
      },
      room.materials.map((item) => ({
        id: item.id,
        kind: "material",
        name: item.filename,
        value: "已保存的原始材料",
      })),
      selectedMaterial ? [selectedMaterial] : [],
    ),
  );
  if (!room.materials.length) return null;
  return (
    <section
      className="panel ia-material-library"
      aria-label="已保存的原始材料"
    >
      <h3>已保存的原始材料</h3>
      <div className="actions">
        {room.materials.map((item) => (
          <Button
            key={item.id}
            data-amadeus-id={item.id}
            aria-pressed={selectedMaterial === item.id}
            variant={selectedMaterial === item.id ? "primary" : undefined}
            onClick={() =>
              selectMaterial((current) =>
                current === item.id ? undefined : item.id,
              )
            }
          >
            <FolderOpen size={16} aria-hidden="true" /> {item.filename}
          </Button>
        ))}
      </div>
    </section>
  );
}
