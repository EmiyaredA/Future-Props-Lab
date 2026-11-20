import { useEffect, useState } from "react";
import { orderedReferenceIds } from "./referenceOrder";
import type { ResolvedCanvasInput } from "./generationDrawerTypes";

export function useReferenceImageOrder(
  manual: string[],
  linked: string[],
  inputs: ResolvedCanvasInput[],
  saved?: string[] | null,
) {
  const [order, setOrder] = useState<string[] | null>(saved ?? null);
  useEffect(() => setOrder(saved ?? null), [saved]);
  const keyFor = (id: string) =>
    inputs.find((input) => input.kind === "image" && input.assetId === id)
      ?.key ?? `asset:${id}`;
  const all = orderedReferenceIds(manual, linked);
  const identities = new Map(all.map((id) => [keyFor(id), id]));
  const images = orderedReferenceIds(
    (order ?? []).flatMap((key) =>
      identities.has(key) ? [identities.get(key)!] : [],
    ),
    all,
  );
  return { images, keyFor, setOrder, order: images.map(keyFor) };
}
