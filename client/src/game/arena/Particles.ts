import * as THREE from 'three';

let dot: THREE.CanvasTexture | null = null;
function dotTexture() {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c);
  return dot;
}

/** Ring-buffer particle system (soft additive dots): dust puffs, landing rings, sparkles. */
export class Particles {
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly base: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private readonly tmp = new THREE.Color();
  private head = 0;

  constructor(
    scene: THREE.Scene,
    private readonly max: number,
    size: number,
    private readonly gravity: number,
  ) {
    this.pos = new Float32Array(max * 3).fill(0);
    this.col = new Float32Array(max * 3).fill(0);
    this.base = new Float32Array(max * 3).fill(0);
    this.vel = new Float32Array(max * 3).fill(0);
    this.life = new Float32Array(max).fill(0);
    this.maxLife = new Float32Array(max).fill(1);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const points = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({
        size,
        map: dotTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    points.frustumCulled = false;
    points.renderOrder = 8;
    scene.add(points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.ColorRepresentation) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.tmp.set(color);
    this.base.set([this.tmp.r, this.tmp.g, this.tmp.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  burst(x: number, y: number, z: number, count: number, speed: number, color: THREE.ColorRepresentation, up = 3) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.emit(x, y, z, Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s, 0.7 + Math.random() * 0.6, color);
    }
  }

  ring(x: number, z: number, count: number, speed: number, color: THREE.ColorRepresentation) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.emit(x, 0.15, z, Math.cos(a) * speed, 0.6, Math.sin(a) * speed, 0.6 + Math.random() * 0.3, color);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.col[k] = this.col[k + 1] = this.col[k + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.vel[k + 1] += this.gravity * dt;
      this.vel[k] *= 0.97;
      this.vel[k + 2] *= 0.97;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] = Math.max(0.05, this.pos[k + 1] + this.vel[k + 1] * dt);
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Floating "+120" style texts that rise above a robot and fade out. */
export class Popups {
  private readonly items: { sprite: THREE.Sprite; life: number; vy: number }[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  show(x: number, y: number, z: number, text: string, color = '#3dff8a') {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.font = '900 64px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(10,4,30,0.9)';
    ctx.strokeText(text, 128, 50);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 50);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sprite.scale.set(2.4, 0.9, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 12;
    this.scene.add(sprite);
    this.items.push({ sprite, life: 1.8, vy: 2.2 });
  }

  /** Big emoji (viewer reaction) floating up. */
  showEmoji(x: number, y: number, z: number, emoji: string) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 72);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sprite.scale.set(1.5, 1.5, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.8, y, z);
    sprite.renderOrder = 12;
    this.scene.add(sprite);
    this.items.push({ sprite, life: 2.2, vy: 2.6 });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      it.sprite.position.y += it.vy * dt;
      it.vy *= 0.97;
      it.sprite.material.opacity = Math.min(1, it.life / 0.6);
      if (it.life <= 0) {
        this.scene.remove(it.sprite);
        it.sprite.material.map?.dispose();
        it.sprite.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
