import * as THREE from 'three';
import type { PowerupType } from '@quiz/shared';

/** Little 3D props that show which power-up a robot is under (or using). All of them face +z (the robot's front). */

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Frozen: icicles hanging from the head, shoulders, belly and arms. */
export function makeIcicles() {
  const g = new THREE.Group();
  const ice = new THREE.MeshStandardMaterial({
    color: '#dff6ff',
    emissive: '#5fb8ff',
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.9,
    roughness: 0.12,
    metalness: 0.15,
  });
  const icicle = (x: number, y: number, z: number, len: number, radius: number) => {
    const m = mesh(new THREE.ConeGeometry(radius, len, 6), ice, x, y - len / 2, z);
    m.rotation.x = Math.PI; // tip pointing down
    g.add(m);
  };
  const ring = (count: number, r: number, y: number, minLen: number, maxLen: number, radius: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      icicle(Math.cos(a) * r, y, Math.sin(a) * r, minLen + Math.random() * (maxLen - minLen), radius);
    }
  };
  ring(12, 0.48, 0.45, 0.25, 0.5, 0.07); // shoulders line of the torso
  ring(8, 0.44, -0.42, 0.15, 0.3, 0.06); // belt
  ring(8, 0.31, 0.62, 0.12, 0.26, 0.045); // chin
  for (const side of [-1, 1]) {
    icicle(side * 0.66, 0.1, 0.05, 0.4, 0.06);
    icicle(side * 0.62, -0.2, -0.04, 0.3, 0.05);
    icicle(side * 0.5, -0.82, 0.1, 0.32, 0.055); // under the hands
  }
  // frost crystals on top of the head
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const c = mesh(new THREE.ConeGeometry(0.05, 0.22, 5), ice, Math.cos(a) * 0.12, 1.06, Math.sin(a) * 0.12);
    c.rotation.z = Math.cos(a) * 0.4;
    c.rotation.x = Math.sin(a) * 0.4;
    g.add(c);
  }
  return g;
}

/** Shield: round steel-blue shield with a golden rim and cross. */
export function makeShield() {
  const g = new THREE.Group();
  const blue = new THREE.MeshStandardMaterial({ color: '#2d6fe0', metalness: 0.7, roughness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: '#ffcc00', emissive: '#7a5a00', emissiveIntensity: 0.35, metalness: 0.9, roughness: 0.2 });
  const disc = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.07, 32), blue);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  g.add(mesh(new THREE.TorusGeometry(0.46, 0.05, 10, 36), gold, 0, 0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.1, 14, 10), gold, 0, 0, 0.07));
  g.add(mesh(new THREE.BoxGeometry(0.56, 0.08, 0.02), gold, 0, 0, 0.045));
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.56, 0.02), gold, 0, 0, 0.045));
  return g;
}

/** Bet: a sack of money with a "$". */
export function makeMoneyBag() {
  const g = new THREE.Group();
  const sack = new THREE.MeshStandardMaterial({ color: '#c9a15f', roughness: 0.85 });
  const body = mesh(new THREE.SphereGeometry(0.27, 18, 14), sack);
  body.scale.set(1, 0.95, 1);
  g.add(body);
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.14, 12), sack, 0, 0.26, 0));
  const frill = mesh(new THREE.ConeGeometry(0.18, 0.2, 12), sack, 0, 0.4, 0);
  g.add(frill);
  const tie = mesh(new THREE.TorusGeometry(0.115, 0.028, 8, 16), new THREE.MeshStandardMaterial({ color: '#d33', roughness: 0.5 }), 0, 0.31, 0);
  tie.rotation.x = Math.PI / 2;
  g.add(tie);
  const dollar = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({
      transparent: true,
      map: canvasTexture((ctx, s) => {
        ctx.font = `900 ${s * 0.9}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#5a3d00';
        ctx.fillText('$', s / 2, s / 2 + 6);
      }),
    }),
  );
  dollar.position.set(0, -0.02, 0.265);
  g.add(dollar);
  return g;
}

/** Bombs: a small cartoon bomb with a sparking fuse. */
export function makeBomb() {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#17171f', metalness: 0.6, roughness: 0.35 });
  g.add(mesh(new THREE.SphereGeometry(0.13, 14, 12), black));
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 8), new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.8, roughness: 0.3 }), 0, 0.13, 0));
  const fuse = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 5), new THREE.MeshStandardMaterial({ color: '#c9a56b' }), 0.03, 0.22, 0);
  fuse.rotation.z = -0.5;
  g.add(fuse);
  const spark = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: '#ffb23d',
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: canvasTexture((ctx, s) => {
        const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,170,40,0.8)');
        grad.addColorStop(1, 'rgba(255,100,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
      }, 64),
    }),
  );
  spark.scale.set(0.2, 0.2, 1);
  spark.position.set(0.06, 0.28, 0);
  spark.name = 'spark';
  g.add(spark);
  return g;
}

/** Reduced time: a little alarm clock with moving hands. */
export function makeClock() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#e03b3b', metalness: 0.4, roughness: 0.4 });
  const face = new THREE.MeshStandardMaterial({ color: '#fffdf2', roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#222' });
  const disc = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.09, 28), face);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  g.add(mesh(new THREE.TorusGeometry(0.36, 0.05, 10, 32), red));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tick = mesh(new THREE.BoxGeometry(0.025, i % 3 === 0 ? 0.08 : 0.045, 0.02), dark, Math.sin(a) * 0.29, Math.cos(a) * 0.29, 0.05);
    tick.rotation.z = -a;
    g.add(tick);
  }
  for (const side of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.1, 12, 8), red, side * 0.24, 0.36, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), dark, side * 0.2, -0.38, 0));
  }
  const hand = (len: number, w: number, name: string) => {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.z = 0.06;
    pivot.add(mesh(new THREE.BoxGeometry(w, len, 0.02), dark, 0, len / 2 - 0.02, 0));
    g.add(pivot);
  };
  hand(0.25, 0.04, 'hour');
  hand(0.32, 0.028, 'minute');
  g.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), red, 0, 0, 0.07));
  return g;
}

/** What an attacker carries in his hand while running to the target (null = bare hand, e.g. a slap). */
export function makeHandItem(type: PowerupType): THREE.Object3D | null {
  const g = new THREE.Group();
  switch (type) {
    case 'freeze': {
      const ice = new THREE.MeshStandardMaterial({ color: '#dff6ff', emissive: '#5fb8ff', emissiveIntensity: 0.7, transparent: true, opacity: 0.88, roughness: 0.1 });
      g.add(mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), ice));
      const shard = mesh(new THREE.ConeGeometry(0.08, 0.22, 5), ice, 0.12, 0.26, 0);
      shard.rotation.z = -0.4;
      g.add(shard);
      return g;
    }
    case 'slime': {
      const goo = new THREE.MeshStandardMaterial({ color: '#3cff5a', emissive: '#1f9a35', emissiveIntensity: 0.6, roughness: 0.25 });
      g.add(mesh(new THREE.SphereGeometry(0.25, 14, 12), goo));
      for (const [x, y] of [[0.18, -0.2], [-0.12, -0.28], [0.02, -0.34]]) g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), goo, x, y, 0.05));
      return g;
    }
    case 'reduce_time': {
      const clock = makeClock();
      clock.scale.setScalar(0.55);
      return clock;
    }
    case 'bombs': {
      const bomb = makeBomb();
      bomb.scale.setScalar(1.7);
      return bomb;
    }
    case 'catapult': {
      const white = new THREE.MeshStandardMaterial({ color: '#f4f4f8', roughness: 0.4 });
      const red = new THREE.MeshStandardMaterial({ color: '#e03b3b', roughness: 0.4 });
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12), white));
      g.add(mesh(new THREE.ConeGeometry(0.1, 0.22, 12), red, 0, 0.36, 0));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const fin = mesh(new THREE.BoxGeometry(0.03, 0.2, 0.16), red, Math.cos(a) * 0.12, -0.2, Math.sin(a) * 0.12);
        fin.rotation.y = -a;
        g.add(fin);
      }
      g.add(mesh(new THREE.ConeGeometry(0.07, 0.2, 8), new THREE.MeshBasicMaterial({ color: '#ffb23d' }), 0, -0.4, 0)).rotation.x = Math.PI;
      return g;
    }
    case 'bet': {
      const bag = makeMoneyBag();
      bag.scale.setScalar(0.8);
      return bag;
    }
    default:
      return null;
  }
}

function starShape(outer: number, inner: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / 5 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Dizzy: little yellow stars that circle above the head. */
export function makeStars() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: '#ffe14d', emissive: '#ffb300', emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.15, 0.065), { depth: 0.05, bevelEnabled: false }), gold);
    star.name = `star${i}`;
    g.add(star);
  }
  return g;
}
