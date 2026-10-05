export const ARENA_HALF = 20;
export const PLATFORM_SIZE = 6;
export const CENTER_RADIUS = 4.5;
export const PIT_Y = -14;
export const ROBOT_HALF_HEIGHT = 1;

/** Platform centres (x, z) for answers A, B, C, D. Camera looks from +z. */
export const PLATFORM_CENTERS: [number, number][] = [
  [-8, -6],
  [8, -6],
  [-8, 6],
  [8, 6],
];

/** Sunflower spiral inside the start circle. */
export function centerSlot(i: number): [number, number] {
  const angle = i * 2.39996 + 0.6;
  const r = 0.95 * Math.sqrt(i + 0.6);
  return [Math.cos(angle) * r, Math.sin(angle) * r * 0.85];
}

export function platformSlot(platform: number, k: number, n: number): [number, number] {
  const [cx, cz] = PLATFORM_CENTERS[platform];
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const gap = cols === 2 ? 2.2 : cols === 3 ? 1.7 : 1.3;
  const row = Math.floor(k / cols);
  const col = k % cols;
  const rows = Math.ceil(n / cols);
  return [cx + (col - (cols - 1) / 2) * gap, cz + (row - (rows - 1) / 2) * gap];
}

/** Floor slabs (minX, maxX, minZ, maxZ) that leave square holes for the four trapdoors. */
export function floorSegments(): [number, number, number, number][] {
  const h = PLATFORM_SIZE / 2;
  const holes = PLATFORM_CENTERS.map(([x, z]) => [x - h, x + h, z - h, z + h]);
  const zCuts = [...new Set([-ARENA_HALF, ARENA_HALF, ...holes.flatMap((r) => [r[2], r[3]])])].sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < zCuts.length - 1; i++) {
    const z0 = zCuts[i];
    const z1 = zCuts[i + 1];
    const zm = (z0 + z1) / 2;
    const blocked = holes.filter((r) => zm > r[2] && zm < r[3]).map((r) => [r[0], r[1]]).sort((a, b) => a[0] - b[0]);
    let x = -ARENA_HALF;
    for (const [b0, b1] of blocked) {
      if (b0 > x) out.push([x, b0, z0, z1]);
      x = Math.max(x, b1);
    }
    if (x < ARENA_HALF) out.push([x, ARENA_HALF, z0, z1]);
  }
  return out;
}
