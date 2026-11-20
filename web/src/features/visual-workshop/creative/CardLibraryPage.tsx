import type { ReactNode } from "react";
import { WorkshopAppChrome } from "@shared/ui/WorkshopAppChrome";
import { AssetCards } from "./AssetCards";

export default function CardLibraryPage({
  utilities,
  readOnly,
}: {
  utilities?: ReactNode;
  readOnly?: boolean;
}) {
  return (
    <section className="workshop-page design-library-page">
      <WorkshopAppChrome title="设定库" utilities={utilities} />
      <AssetCards readOnly={readOnly} />
    </section>
  );
}
