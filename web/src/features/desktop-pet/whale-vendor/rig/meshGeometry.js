/** Runtime mesh topology; every face keeps one source region and its original UV. */
const EPS = 1e-9;
const area = (p) =>
  p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a[0] * b[1] - a[1] * b[0];
  }, 0) / 2;
function source(part) {
  const [x, y, w, h] = part.box;
  const [nx, ny] = part.grid ?? [6, 6];
  const uv = part.uvBox ?? [0, 0, 1, 1];
  if (
    ![x, y, w, h, nx, ny, ...uv].every(Number.isFinite) ||
    w <= 0 ||
    h <= 0 ||
    !Number.isInteger(nx) ||
    !Number.isInteger(ny) ||
    nx < 1 ||
    ny < 1 ||
    nx > 128 ||
    ny > 128
  )
    throw new Error("Invalid rig mesh source");
  return { x, y, w, h, nx, ny, uv };
}
function inside(point, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
const side = (p, a, b) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function half(polygon, a, b, sign) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length];
    const dp = side(p, a, b) * sign,
      dq = side(q, a, b) * sign;
    if (dp >= -EPS) result.push(p);
    if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
      const u = dp / (dp - dq);
      result.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
    }
  }
  return result.filter((p, i) => {
    const q = result[(i + result.length - 1) % result.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > EPS;
  });
}
function append(mesh, map, points, owner, spec) {
  const ids = points.map((p) => {
    // Region identities intentionally duplicate boundary vertices: a triangle
    // must never interpolate between two different limb ownership chains.
    const key = `${owner ?? ""}:${p[0].toFixed(8)}:${p[1].toFixed(8)}`;
    if (!map.has(key)) {
      map.set(key, mesh.owners.length);
      mesh.positions.push(p[0], p[1]);
      const [u0, v0, u1, v1] = spec.uv;
      mesh.uv.push(
        u0 + ((p[0] - spec.x) / spec.w) * (u1 - u0),
        v0 + ((p[1] - spec.y) / spec.h) * (v1 - v0),
      );
      mesh.owners.push(owner);
    }
    return map.get(key);
  });
  for (let i = 1; i < ids.length - 1; i++)
    mesh.indices.push(ids[0], ids[i], ids[i + 1]);
}
function typed(mesh, discardRoundoff = true) {
  const positions = new Float32Array(mesh.positions),
    uv = new Float32Array(mesh.uv);
  const indices = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3);
    const cross =
      (positions[b * 2] - positions[a * 2]) *
        (positions[c * 2 + 1] - positions[a * 2 + 1]) -
      (positions[b * 2 + 1] - positions[a * 2 + 1]) *
        (positions[c * 2] - positions[a * 2]);
    // Discard only rest-space roundoff slivers that collapse in Float32. No
    // animated inverted face is ever removed, and no visible hole is patched.
    if (!discardRoundoff || cross > 1e-8) indices.push(a, b, c);
  }
  return {
    positions,
    uv,
    indices:
      mesh.owners.length > 65535
        ? new Uint32Array(indices)
        : new Uint16Array(indices),
    owners: mesh.owners,
  };
}
/** Regular mesh remains the default for existing packages. */
export function gridMesh(part) {
  const spec = source(part),
    mesh = { positions: [], uv: [], indices: [], owners: [] };
  const { x, y, w, h, nx, ny } = spec;
  for (let r = 0; r <= ny; r++)
    for (let c = 0; c <= nx; c++) {
      const [u0, v0, u1, v1] = spec.uv;
      mesh.positions.push(x + (w * c) / nx, y + (h * r) / ny);
      mesh.uv.push(u0 + ((u1 - u0) * c) / nx, v0 + ((v1 - v0) * r) / ny);
      mesh.owners.push(null);
    }
  for (let r = 0; r < ny; r++)
    for (let c = 0; c < nx; c++) {
      const a = r * (nx + 1) + c,
        b = a + 1,
        d = a + nx + 1;
      mesh.indices.push(a, b, d, b, d + 1, d);
    }
  return typed(mesh, false);
}
/**
 * Conforming subdivision along all region boundaries. Concave/overlapping
 * simple polygons are supported; earlier regions own overlap. Unclaimed body
 * area is retained, including transparent source pixels. PNGs are untouched.
 * Recompute skin weights using the returned owner and source position; reusing
 * the old rectangular-grid weights would recreate the original mixed chains.
 */
export function buildRegionMesh(part, regions) {
  const spec = source(part);
  if (
    regions.length > 16 ||
    new Set(regions.map((r) => r.id)).size !== regions.length
  )
    throw new Error("Invalid rig mesh regions");
  const lines = [];
  for (const region of regions) {
    if (
      !region.id ||
      region.polygon.length < 3 ||
      region.polygon.length > 32 ||
      region.polygon.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
      Math.abs(area(region.polygon)) < EPS
    )
      throw new Error("Invalid rig mesh polygon");
    for (let i = 0; i < region.polygon.length; i++) {
      const a = region.polygon[i],
        b = region.polygon[(i + 1) % region.polygon.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > EPS) lines.push([a, b]);
    }
  }
  if (lines.length > 128) throw new Error("Rig mesh region budget exceeded");
  const mesh = { positions: [], uv: [], indices: [], owners: [] },
    map = new Map();
  const { x, y, w, h, nx, ny } = spec;
  for (let r = 0; r < ny; r++)
    for (let c = 0; c < nx; c++) {
      const a = [x + (w * c) / nx, y + (h * r) / ny],
        b = [x + (w * (c + 1)) / nx, a[1]],
        d = [a[0], y + (h * (r + 1)) / ny],
        e = [b[0], d[1]];
      for (const triangle of [
        [a, b, d],
        [b, e, d],
      ]) {
        let fragments = [triangle];
        for (const [p, q] of lines) {
          const next = [];
          for (const fragment of fragments) {
            const signs = fragment.map((v) => side(v, p, q));
            if (Math.min(...signs) < -EPS && Math.max(...signs) > EPS) {
              for (const sign of [1, -1]) {
                const clipped = half(fragment, p, q, sign);
                if (clipped.length >= 3 && area(clipped) > EPS)
                  next.push(clipped);
              }
            } else next.push(fragment);
          }
          fragments = next;
        }
        for (const fragment of fragments) {
          const center = [0, 1].map(
            (axis) =>
              fragment.reduce((v, p) => v + p[axis], 0) / fragment.length,
          );
          const owner =
            regions.find((region) => inside(center, region.polygon))?.id ??
            null;
          append(mesh, map, fragment, owner, spec);
        }
        if (mesh.owners.length > 250000)
          throw new Error("Rig mesh vertex budget exceeded");
      }
    }
  return typed(mesh);
}
/** Renderer entry accepts compiled runtime geometry, never unchecked buffer shapes. */
export function validateMesh(mesh) {
  const n = mesh.positions.length / 2;
  if (
    !(mesh.positions instanceof Float32Array) ||
    !(mesh.uv instanceof Float32Array) ||
    !(
      mesh.indices instanceof Uint16Array || mesh.indices instanceof Uint32Array
    ) ||
    !Number.isInteger(n) ||
    n < 3 ||
    n > 250000 ||
    mesh.uv.length !== mesh.positions.length ||
    mesh.owners.length !== n ||
    mesh.owners.some((owner) => owner !== null && typeof owner !== "string") ||
    mesh.indices.length > 1500000 ||
    mesh.indices.length % 3 ||
    ![...mesh.positions, ...mesh.uv].every(Number.isFinite) ||
    [...mesh.indices].some((i) => !Number.isInteger(i) || i < 0 || i >= n) ||
    (mesh.skin?.length ?? 0) > 64 ||
    mesh.skin?.some(
      (binding) =>
        !binding.deformer ||
        binding.weights.length !== n ||
        binding.weights.some((w) => !Number.isFinite(w) || w < 0 || w > 1),
    )
  )
    throw new Error("Invalid compiled rig mesh");
  for (let i = 0; i < n; i++)
    if (
      (mesh.skin?.reduce((sum, binding) => sum + binding.weights[i], 0) ?? 0) >
      1 + 1e-6
    )
      throw new Error("Invalid compiled rig mesh weight sum");
  return mesh;
}
