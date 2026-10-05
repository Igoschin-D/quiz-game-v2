import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { ANSWER_LETTERS, THEME } from '@quiz/shared';
import { PLATFORM_CENTERS, PLATFORM_SIZE } from '../arena/layout';
import { platformHalfTextures, signTexture } from '../arena/textures';

type R = typeof RAPIER;
export type PlatformState = 'neutral' | 'correct' | 'wrong';

const THICK = 0.5;
const OPEN_ANGLE = 1.75;

interface Half {
  side: -1 | 1;
  mesh: THREE.Mesh;
  topMat: THREE.MeshStandardMaterial;
  sideMat: THREE.MeshStandardMaterial;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  hinge: THREE.Vector3;
}

export class Trapdoor {
  private readonly halves: Half[] = [];
  private readonly sign: THREE.Sprite;
  private readonly rim: THREE.Mesh;
  private readonly rimMat: THREE.MeshStandardMaterial;
  private readonly glow: THREE.PointLight;
  private open = 0;
  private openTarget = 0;
  private state: PlatformState = 'neutral';
  private text = '';
  private readonly color: string;
  private readonly textColor: string;
  private readonly letter: string;
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);

  constructor(rapier: R, world: RAPIER.World, scene: THREE.Scene, readonly index: number) {
    const [cx, cz] = PLATFORM_CENTERS[index];
    this.color = THEME.platformColors[index];
    this.textColor = THEME.platformTextColors[index];
    this.letter = ANSWER_LETTERS[index];
    const half = PLATFORM_SIZE / 2;

    for (const side of [-1, 1] as const) {
      const topMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.1 });
      const sideMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.5, metalness: 0.2 });
      const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(half, THICK, PLATFORM_SIZE), mats);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      scene.add(mesh);
      const hinge = new THREE.Vector3(cx + side * half, 0, cz);
      const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
      const collider = world.createCollider(rapier.ColliderDesc.cuboid(half / 2, THICK / 2, half).setFriction(0.8), body);
      this.halves.push({ side, mesh, topMat, sideMat, body, collider, hinge });
    }

    this.rimMat = new THREE.MeshStandardMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 0.35 });
    const rimShape = new THREE.Shape();
    const o = half + 0.35;
    rimShape.moveTo(-o, -o).lineTo(o, -o).lineTo(o, o).lineTo(-o, o).lineTo(-o, -o);
    const holeShape = new THREE.Path();
    holeShape.moveTo(-half, -half).lineTo(-half, half).lineTo(half, half).lineTo(half, -half).lineTo(-half, -half);
    rimShape.holes.push(holeShape);
    this.rim = new THREE.Mesh(new THREE.ShapeGeometry(rimShape), this.rimMat);
    this.rim.rotation.x = -Math.PI / 2;
    this.rim.position.set(cx, 0.02, cz);
    scene.add(this.rim);

    this.sign = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.sign.scale.set(6.4, 1.6, 1);
    this.sign.position.set(cx, 4.6, cz - (cz < 0 ? 1.2 : -0.4));
    this.sign.renderOrder = 5;
    scene.add(this.sign);

    this.glow = new THREE.PointLight(THEME.correct, 0, 14, 1.5);
    this.glow.position.set(cx, 3, cz);
    scene.add(this.glow);

    this.setAnswer('');
    this.apply();
  }

  /** The floating answer sign (hidden in the finale: it would block the view of the podium). */
  setSignVisible(visible: boolean) {
    this.sign.visible = visible;
  }

  setAnswer(text: string) {
    if (text === this.text && this.halves[0].topMat.map) return;
    this.text = text;
    const tex = platformHalfTextures(this.letter, text || '?', this.color, this.textColor);
    this.halves.forEach((h, i) => {
      h.topMat.map?.dispose();
      h.topMat.map = tex[h.side === -1 ? 0 : 1] ?? tex[i];
      h.topMat.needsUpdate = true;
    });
    this.refreshSign();
  }

  setState(state: PlatformState) {
    if (state === this.state) return;
    this.state = state;
    const dim = state === 'wrong';
    for (const h of this.halves) {
      h.topMat.color.set(dim ? '#6b5560' : '#ffffff');
      h.sideMat.color.set(dim ? '#4a2232' : this.color);
      h.topMat.emissive.set(state === 'correct' ? THEME.correct : '#000000');
      h.topMat.emissiveIntensity = state === 'correct' ? 0.18 : 0;
    }
    this.rimMat.color.set(state === 'correct' ? THEME.correct : state === 'wrong' ? THEME.wrong : this.color);
    this.rimMat.emissive.set(state === 'correct' ? THEME.correct : state === 'wrong' ? THEME.wrong : this.color);
    this.glow.intensity = state === 'correct' ? 40 : 0;
    this.refreshSign();
  }

  setOpen(open: boolean) {
    this.openTarget = open ? 1 : 0;
    // Swinging doors must not shove robots around: while open they are visual only.
    if (open) for (const h of this.halves) h.collider.setSensor(true);
  }

  get isOpen() {
    return this.open > 0.05;
  }

  update(dt: number, time: number) {
    const speed = this.openTarget > this.open ? 3.2 : 1.6;
    this.open += Math.sign(this.openTarget - this.open) * Math.min(Math.abs(this.openTarget - this.open), dt * speed);
    if (this.openTarget === 0 && this.open === 0 && this.halves[0].collider.isSensor()) {
      for (const h of this.halves) h.collider.setSensor(false);
    }
    this.apply();
    if (this.state === 'correct') {
      this.rimMat.emissiveIntensity = 0.8 + Math.sin(time * 8) * 0.5;
      this.glow.intensity = 30 + Math.sin(time * 8) * 12;
    } else {
      this.rimMat.emissiveIntensity = this.state === 'wrong' ? 0.6 : 0.35;
    }
  }

  private apply() {
    const half = PLATFORM_SIZE / 2;
    for (const h of this.halves) {
      const angle = h.side * this.open * OPEN_ANGLE;
      this.q.setFromAxisAngle(Trapdoor.Z, angle);
      this.v.set(-h.side * (half / 2), -THICK / 2, 0).applyQuaternion(this.q).add(h.hinge);
      h.body.setNextKinematicTranslation({ x: this.v.x, y: this.v.y, z: this.v.z });
      h.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
      h.mesh.position.copy(this.v);
      h.mesh.quaternion.copy(this.q);
    }
  }

  private refreshSign() {
    const mat = this.sign.material;
    mat.map?.dispose();
    mat.map = signTexture(this.letter, this.text || '…', this.color, this.textColor, this.state);
    mat.needsUpdate = true;
  }
}
