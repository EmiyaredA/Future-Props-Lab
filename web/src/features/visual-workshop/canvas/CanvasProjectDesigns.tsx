import { lazy, Suspense, useState } from "react";
import { X, Search } from "lucide-react";
import { apiErrorMessage } from "@platform/api/errors";
import { CommonDesignCards } from "../board/CommonDesignCards";
import { DesignCardPicker } from "../creative/DesignCardPicker";
import {
  cardsKey,
  createCard,
  type Card,
  type CardKind,
} from "../creative/api";
import { resolveDesignImage } from "../creative/cardMedia";
import type { useVisualCanvasController } from "./useVisualCanvasController";
import "../board/board-design-cards.css";
import "./canvas-project-designs.css";

const CardEditor = lazy(() =>
  import("../creative/AssetCards").then(({ AssetCards }) => ({
    default: AssetCards,
  })),
);
const labels = { character: "人设", scene: "场景", prop: "道具" };
type Controller = Pick<
  ReturnType<typeof useVisualCanvasController>,
  | "projectId"
  | "projectCardIds"
  | "canvasReady"
  | "conflict"
  | "client"
  | "readCanvas"
  | "replaceProjectCardIds"
  | "nodes"
  | "selectedId"
  | "createMediaNodeFromAsset"
  | "getInsertionAnchor"
  | "prepareCanvasForAgent"
  | "setSelectedId"
  | "revealNodes"
>;

export function CanvasProjectDesigns({
  controller: c,
  kind,
  onClose,
  onUse,
  onOpenPrevis,
}: {
  controller: Controller;
  kind: CardKind;
  onOpenPrevis?: (id: string) => void;
  onClose: () => void;
  onUse: (card: Card) => void;
}) {
  const [searches, setSearches] = useState<Record<CardKind, string>>({
    character: "",
    scene: "",
    prop: "",
  });
  const [picker, setPicker] = useState<CardKind>();
  const [editing, setEditing] = useState<Card>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const selected = c.nodes.find((node) => node.id === c.selectedId);
  const add = async (cards: Card[]) => {
    await c.replaceProjectCardIds([
      ...new Set([
        ...c.readCanvas().projectCardIds,
        ...cards.map(({ id }) => id),
      ]),
    ]);
  };
  function run(action: () => Promise<unknown>) {
    if (pending) return;
    setPending(true);
    setError("");
    void action()
      .catch((failure) => setError(apiErrorMessage(failure)))
      .finally(() => setPending(false));
  }
  return (
    <aside
      className="canvas-assets-drawer canvas-project-designs"
      aria-label={`项目${labels[kind]}`}
    >
      <header>
        <strong>{labels[kind]}</strong>
        <button aria-label={`关闭${labels[kind]}`} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <label className="canvas-design-search">
        <Search size={16} />
        <input
          aria-label={`搜索${labels[kind]}`}
          placeholder={`搜索${labels[kind]}、标签…`}
          value={searches[kind]}
          onChange={(event) =>
            setSearches({ ...searches, [kind]: event.target.value })
          }
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="canvas-design-content">
        <CommonDesignCards
          projectId={c.projectId}
          ids={c.projectCardIds}
          kind={kind}
          search={searches[kind]}
          canUse={selected?.kind === "video"}
          disabled={pending || !c.canvasReady || Boolean(c.conflict)}
          onAdd={setPicker}
          onCreate={(kind) =>
            run(async () => {
              const card = await createCard(c.projectId, {
                kind,
                title: `新建${labels[kind]}卡`,
              });
              c.client.setQueryData<Card[]>(cardsKey, (old) => [
                ...(old ?? []),
                card,
              ]);
              await add([card]);
              setEditing(card);
            })
          }
          onView={setEditing}
          onUse={onUse}
          sources={c.nodes}
          onSource={(id) => {
            const node = c.nodes.find((item) => item.id === id);
            if (node) {
              c.setSelectedId(id);
              c.revealNodes([node]);
            }
          }}
          onRemove={(card) =>
            run(() =>
              c.replaceProjectCardIds(
                c.readCanvas().projectCardIds.filter((id) => id !== card.id),
              ),
            )
          }
          onCanvas={(card) =>
            run(async () => {
              const id = await resolveDesignImage(
                c.client,
                c.projectId,
                card,
                c.readCanvas().nodes,
              );
              c.createMediaNodeFromAsset(
                {
                  id,
                  media_kind: "image",
                  display_name: card.title,
                  design_card_id: card.id,
                  design_card_revision: card.revision,
                },
                c.getInsertionAnchor(),
              );
              await c.prepareCanvasForAgent();
            })
          }
        />
      </div>
      {picker && (
        <DesignCardPicker
          kind={picker}
          title="从设定库添加"
          exclude={c.projectCardIds}
          excludedLabel="已添加到项目"
          confirmLabel="添加到项目"
          onClose={() => setPicker(undefined)}
          onChoose={add}
        />
      )}
      {editing && (
        <Suspense fallback={<p role="status">正在打开设定卡…</p>}>
          <CardEditor
            key={editing.id}
            project={c.projectId}
            fixedKind={editing.kind}
            initialCardId={editing.id}
            onOpenPrevis={onOpenPrevis}
            onCreated={(card) => add([card])}
            onCloseCard={() => setEditing(undefined)}
          />
        </Suspense>
      )}
    </aside>
  );
}
