import {
  AlphaMask,
  Container,
  Mesh,
  MeshGeometry,
  type Texture,
} from "pixi.js";
import type { PosedPart } from "./pose";

function positions(part: PosedPart): Float32Array {
  return new Float32Array(
    part.worldVertices.flatMap((point) => [point.x, point.y]),
  );
}

export function createPoseMeshes(
  parts: PosedPart[],
  textures: Map<string, Texture>,
) {
  const container = new Container();
  const meshes = new Map<string, Mesh<MeshGeometry>>();
  const byId = new Map(parts.map((part) => [part.id, part]));
  const make = (
    part: PosedPart,
    visible: boolean,
    visited = new Set<string>(),
  ): Mesh<MeshGeometry> | null => {
    const texture = textures.get(part.assetId);
    if (!texture || visited.has(part.id)) return null;
    visited.add(part.id);
    const mesh = new Mesh({
      geometry: new MeshGeometry({
        positions: positions(part),
        uvs: new Float32Array(part.uvs.flatMap((point) => [point.x, point.y])),
        indices: new Uint32Array(part.triangles),
      }),
      texture,
    });
    mesh.alpha = part.opacity;
    mesh.visible = visible;
    meshes.set(part.id, mesh);
    if (part.maskId) {
      const maskPart = byId.get(part.maskId);
      const mask = maskPart && make(maskPart, true, visited);
      if (mask) {
        container.addChild(mask);
        mesh.addEffect(new AlphaMask({ mask }));
        mesh.setMask({ channel: "alpha", inverse: false });
      }
    }
    return mesh;
  };
  for (const part of parts) {
    const mesh = make(part, part.visible);
    if (mesh) container.addChild(mesh);
  }
  return {
    container,
    update(next: PosedPart[]) {
      for (const part of next) {
        const mesh = meshes.get(part.id);
        if (!mesh) continue;
        mesh.geometry.positions = positions(part);
        mesh.alpha = part.opacity;
        mesh.visible = part.visible;
      }
    },
  };
}
