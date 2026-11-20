import { Boxes, Clapperboard, UserRound } from "lucide-react";
import type { CardKind } from "./api";

export const cardKinds = ["character", "scene", "prop"] as const;

export const cardKindInfo = {
  character: { label: "角色卡", icon: UserRound },
  scene: { label: "场景卡", icon: Clapperboard },
  prop: { label: "道具卡", icon: Boxes },
} satisfies Record<CardKind, { label: string; icon: typeof UserRound }>;
