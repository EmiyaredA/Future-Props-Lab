/** In-memory render geometry only; this is not a resource-package JSON field. */
export type MeshGeometry = {
  positions: Float32Array;
  uv: Float32Array;
  indices: Uint16Array | Uint32Array;
  owners: (string | null)[];
  skin?: { deformer: string; weights: number[] }[];
};
export type MeshSource = { box: number[]; grid?: number[]; uvBox?: number[] };
export type MeshRegion = { id: string; polygon: number[][] };
export function gridMesh(part: MeshSource): MeshGeometry;
export function buildRegionMesh(
  part: MeshSource,
  regions: MeshRegion[],
): MeshGeometry;
export function validateMesh(mesh: MeshGeometry): MeshGeometry;
