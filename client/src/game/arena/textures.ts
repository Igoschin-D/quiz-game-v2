import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = 800) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px "Segoe UI", Roboto, Arial, sans-serif`;
    s -= 4;
  } while (ctx.measureText(text).width > maxWidth && s > 20);
}

function texture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Top face of a trapdoor: big letter + answer text. */
export function platformTopCanvas(letter: string, text: string, color: string, textColor: string) {
  const { c, ctx } = canvas(1024, 1024);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 28;
  ctx.strokeRect(24, 24, 976, 976);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(512, 40);
  ctx.lineTo(512, 984);
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 460px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText(letter, 512, 420);
  fitText(ctx, text, 900, 130);
  ctx.fillText(text, 512, 800);
  return c;
}

export function platformHalfTextures(letter: string, text: string, color: string, textColor: string) {
  const c = platformTopCanvas(letter, text, color, textColor);
  return [0, 0.5].map((offset) => {
    const t = texture(c);
    t.repeat.set(0.5, 1);
    t.offset.set(offset, 0);
    return t;
  });
}

/** Floating sign above a platform: "B · Астана". */
export function signTexture(letter: string, text: string, color: string, textColor: string, state: 'neutral' | 'correct' | 'wrong') {
  const { c, ctx } = canvas(1024, 256);
  roundRect(ctx, 8, 8, 1008, 240, 60);
  ctx.fillStyle = state === 'wrong' ? '#3a1630' : color;
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = state === 'correct' ? '#3dff8a' : state === 'wrong' ? '#ff3d3d' : 'rgba(255,255,255,0.8)';
  ctx.stroke();
  ctx.fillStyle = state === 'wrong' ? '#ffb3b3' : textColor;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '900 170px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText(letter, 56, 136);
  ctx.textAlign = 'center';
  fitText(ctx, state === 'correct' ? `✔ ${text}` : text, 760, 120);
  ctx.fillText(state === 'correct' ? `✔ ${text}` : text, 620, 136);
  return texture(c);
}

export function nameTagTexture(name: string, score: number, delta: number | null, offline: boolean) {
  const { c, ctx } = canvas(512, 168);
  roundRect(ctx, 6, 6, 500, 156, 40);
  ctx.fillStyle = offline ? 'rgba(60,60,70,0.85)' : 'rgba(14,8,40,0.82)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,204,0,0.9)';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  fitText(ctx, name || '…', 470, 64);
  ctx.fillText(name || '…', 256, 58);
  ctx.font = '700 46px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillStyle = delta && delta > 0 ? '#3dff8a' : delta && delta < 0 ? '#ff6b6b' : '#ffcc00';
  const line = offline ? 'нет связи' : delta ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)}  ·  ${score}` : `${score} очков`;
  ctx.fillText(line, 256, 122);
  return texture(c);
}

export function initialsTexture(name: string, color: string) {
  const { c, ctx } = canvas(256, 256);
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, color);
  g.addColorStop(1, '#14082e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 150px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText((name || '?').trim().charAt(0).toUpperCase(), 128, 138);
  return texture(c);
}

export function floorTexture(a: string, b: string) {
  const { c, ctx } = canvas(512, 512);
  const n = 8;
  const s = 512 / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? a : b;
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function bannerTexture(text: string) {
  const { c, ctx } = canvas(2048, 384);
  const g = ctx.createLinearGradient(0, 0, 2048, 0);
  g.addColorStop(0, '#ff4fd8');
  g.addColorStop(0.5, '#ffcc00');
  g.addColorStop(1, '#22d3ee');
  roundRect(ctx, 10, 10, 2028, 364, 80);
  ctx.fillStyle = '#1b0f44';
  ctx.fill();
  ctx.lineWidth = 18;
  ctx.strokeStyle = g;
  ctx.stroke();
  ctx.fillStyle = g;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 210px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText(text, 1024, 200);
  return texture(c);
}

/** Row of emoji (power-up icons) shown above a robot. */
export function emojiTexture(text: string) {
  const { c, ctx } = canvas(320, 112);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '72px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, 160, 58);
  return texture(c);
}

/** Cracked glass: white radial cracks with a soft glow (catapult impact on the "screen"). */
export function crackTexture() {
  const { c, ctx } = canvas(512, 512);
  ctx.translate(256, 256);
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.random() * 0.25;
    let x = 0;
    let y = 0;
    const len = 150 + Math.random() * 100;
    ctx.lineWidth = 3 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let d = 0; d < len; d += 28) {
      x += Math.cos(a + (Math.random() - 0.5) * 0.7) * 28;
      y += Math.sin(a + (Math.random() - 0.5) * 0.7) * 28;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 2.5;
  for (const r of [34, 70, 110]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.setLineDash([22, 18, 8, 26]);
    ctx.stroke();
  }
  return texture(c);
}

/** Big place number for the podium (front face) and for the numbers hovering above the applauding players. */
export function rankTexture(rank: number, color = '#ffcc00', box = false) {
  const { c, ctx } = canvas(256, 256);
  if (box) {
    ctx.fillStyle = 'rgba(0,0,0,0.0)';
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 190px "Segoe UI", Arial, sans-serif';
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(20,8,50,0.95)';
  ctx.strokeText(String(rank), 128, 138);
  ctx.fillStyle = color;
  ctx.fillText(String(rank), 128, 138);
  return texture(c);
}
