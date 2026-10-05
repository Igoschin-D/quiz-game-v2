export type FilterId = 'none' | 'bw' | 'bright' | 'funny' | 'fisheye' | 'pinch' | 'wave' | 'stretch';

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'none', label: 'Оригинал' },
  { id: 'bw', label: 'Ч/Б' },
  { id: 'bright', label: 'Яркий' },
  { id: 'funny', label: 'Смешной' },
  { id: 'fisheye', label: 'Рыбий глаз' },
  { id: 'pinch', label: 'Вмятина' },
  { id: 'wave', label: 'Волны' },
  { id: 'stretch', label: 'Растяжение' },
];

export const BRUSH_COLORS = ['#ff3b3b', '#ffcc00', '#3dff8a', '#22d3ee', '#ffffff', '#111111'];
export const BRUSH_SIZE = 12;

export const STICKERS = ['😎', '👑', '🎉', '🤡', '❤️', '🔥'];

/** x, y (0..1) and relative size for successive stickers. */
export const STICKER_SPOTS: [number, number, number][] = [
  [0.5, 0.16, 1],
  [0.17, 0.2, 0.7],
  [0.83, 0.2, 0.7],
  [0.18, 0.84, 0.7],
  [0.82, 0.84, 0.7],
  [0.5, 0.88, 0.6],
];

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Geometric distortions (from the first version of the game): fish-eye, pinch, waves, stretch. */
function distort(src: ImageData, filter: 'fisheye' | 'pinch' | 'wave' | 'stretch'): ImageData {
  const { width: w, height: h } = src;
  const out = new ImageData(w, h);
  const s = src.data;
  const d = out.data;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(cx, cy);
  const amp = w * 0.0375;
  const period = w / 8;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = x;
      let sy = y;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy) / maxR;
      if ((filter === 'fisheye' || filter === 'pinch') && r <= 1) {
        const theta = Math.atan2(dy, dx);
        const nr = Math.pow(r, filter === 'fisheye' ? 0.5 : 1.8);
        sx = cx + Math.cos(theta) * nr * maxR;
        sy = cy + Math.sin(theta) * nr * maxR;
      } else if (filter === 'wave') {
        sx = x + amp * Math.sin((2 * Math.PI * y) / period);
        sy = y + amp * Math.sin((2 * Math.PI * x) / period);
      } else if (filter === 'stretch') {
        sx = cx + dx * (1 + 0.35 * Math.sin((Math.PI * y) / h));
      }
      const si = (Math.min(h - 1, Math.max(0, Math.round(sy))) * w + Math.min(w - 1, Math.max(0, Math.round(sx)))) * 4;
      const di = (y * w + x) * 4;
      d[di] = s[si];
      d[di + 1] = s[si + 1];
      d[di + 2] = s[si + 2];
      d[di + 3] = 255;
    }
  }
  return out;
}

export function applyFilter(src: ImageData, filter: FilterId): ImageData {
  if (filter === 'none') return src;
  if (filter === 'fisheye' || filter === 'pinch' || filter === 'wave' || filter === 'stretch') return distort(src, filter);
  const { width: w, height: h } = src;
  const out = new ImageData(w, h);
  const s = src.data;
  const d = out.data;

  if (filter === 'funny') {
    const cx = w / 2;
    const cy = h * 0.46;
    const R = Math.min(w, h) * 0.55;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy) / R;
        let sx = x;
        let sy = y;
        if (r < 1 && r > 0) {
          const k = Math.pow(r, 1.7) / r;
          sx = cx + dx * k;
          sy = cy + dy * k;
        }
        const si = (Math.min(h - 1, Math.max(0, Math.round(sy))) * w + Math.min(w - 1, Math.max(0, Math.round(sx)))) * 4;
        const di = (y * w + x) * 4;
        const gray = (s[si] + s[si + 1] + s[si + 2]) / 3;
        d[di] = clamp(gray + (s[si] - gray) * 1.9 + 10);
        d[di + 1] = clamp(gray + (s[si + 1] - gray) * 1.9);
        d[di + 2] = clamp(gray + (s[si + 2] - gray) * 1.9 + 25);
        d[di + 3] = 255;
      }
    }
    return out;
  }

  for (let i = 0; i < s.length; i += 4) {
    const r = s[i];
    const g = s[i + 1];
    const b = s[i + 2];
    if (filter === 'bw') {
      const v = clamp((0.299 * r + 0.587 * g + 0.114 * b - 128) * 1.15 + 128);
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i] = clamp(((gray + (r - gray) * 1.45) - 128) * 1.2 + 150);
      d[i + 1] = clamp(((gray + (g - gray) * 1.45) - 128) * 1.2 + 146);
      d[i + 2] = clamp(((gray + (b - gray) * 1.45) - 128) * 1.2 + 140);
    }
    d[i + 3] = 255;
  }
  return out;
}

/** Draw an image into a square canvas (cover crop). */
export function squareCanvas(img: CanvasImageSource, iw: number, ih: number, size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const side = Math.min(iw, ih);
  ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, size, size);
  return c;
}
