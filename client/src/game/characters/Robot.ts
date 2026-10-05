import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { POWERUPS, avatarById, type AvatarId, type PowerupType } from '@quiz/shared';
import { ROBOT_HALF_HEIGHT } from '../arena/layout';
import { emojiTexture, initialsTexture, nameTagTexture } from '../arena/textures';
import { Catapult } from './Catapult';
import { makeBomb, makeClock, makeHandItem, makeIcicles, makeMoneyBag, makeShield, makeStars } from './RobotProps';

type R = typeof RAPIER;

const RUN_SPEED = 6.2;
/** Robots collide with the arena (group 1) but never with each other (group 2 is not in their filter). */
const ROBOT_COLLISION_GROUPS = (0x0002 << 16) | 0x0001;
const loader = new THREE.TextureLoader();

export type Mood = 'idle' | 'think' | 'scared' | 'sad' | 'clap';
export interface RobotEvent {
  type: 'step' | 'land' | 'hop' | 'build' | 'launch' | 'impact' | 'breath' | 'drip';
  x: number;
  y: number;
  z: number;
  power: number;
  /** step: the robot is covered in slime (squelching sound). */
  slimy?: boolean;
}

/**
 * Catapult timeline (seconds): the catapult is built under the robot and it hops into the cup, the arm is cranked back,
 * the arm swings and releases, the robot flies into the screen, is stuck on the "glass" and slides down.
 */
const CATAPULT = { build: 0.7, tension: 0.7, swing: 0.3, flight: 0.7, stick: 0.9, slide: 3.2 };
/** Arm angles: resting, loaded, cranked back, and the release point of the swing. */
const ARM = { rest: -0.15, loaded: -0.55, tense: -0.8, release: 1.0, after: 1.5 };

export class Robot {
  readonly group = new THREE.Group();
  readonly body: RAPIER.RigidBody;
  target: THREE.Vector3 | null = null;
  celebrating = false;
  fallen = false;
  /** Falling through an open trapdoor: straight down, no sideways or upward motion. */
  dropping = false;
  mood: Mood = 'idle';
  /** Shaking with nerves in the last seconds of a question. */
  nervous = false;
  /** Victory spin (finale). */
  spin = false;
  /** Slimed robot tries to shake the slime off while the question is open. */
  shakingOff = false;
  /** Flew out of the picture (catapult); invisible until it respawns. */
  offscreen = false;
  /** Running speed (the power-up show lets attackers sprint across the line-up). */
  runSpeed = RUN_SPEED;
  onEvent: ((e: RobotEvent) => void) | null = null;

  private readonly visual = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly crown = new THREE.Group();
  private readonly fxSprite: THREE.Sprite;
  private fxKey = '';
  private readonly icicles = makeIcicles();
  private readonly shieldProp = makeShield();
  private readonly bagProp = makeMoneyBag();
  private readonly clockProp = makeClock();
  private readonly bombProps = [makeBomb(), makeBomb(), makeBomb()];
  private readonly bombOrbit = new THREE.Group();
  private readonly stars = makeStars();
  private dizzyT = 0;
  private heldType: PowerupType | null = null;
  private held: THREE.Object3D | null = null;
  private act: { kind: 'slap' | 'give'; t: number; dur: number; hitAt: number; onHit?: () => void; hit: boolean } | null = null;
  private frozen = false;
  private slimy = false;
  private hasShield = false;
  private hasBag = false;
  private tint: { color: THREE.Color; amount: number } = { color: new THREE.Color('#ffffff'), amount: 0 };
  private fxTimer = 0;
  private script: {
    t: number;
    cam: THREE.Camera;
    start: THREE.Vector3;
    local: THREE.Vector3;
    cat: Catapult;
    built: boolean;
    launched: boolean;
    hit: boolean;
  } | null = null;
  private hasCrown = false;
  private squash = 0;
  private prevVy = 0;
  private stepTimer = 0;
  private lean = 0;
  private tumbleX = 0;
  private tumbleZ = 0;
  private readonly phase = Math.random() * 10;
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly bodyMats: THREE.MeshStandardMaterial[] = [];
  private readonly accentMats: THREE.MeshStandardMaterial[] = [];
  private readonly eyeMat: THREE.MeshStandardMaterial;
  private readonly screenMat: THREE.MeshBasicMaterial;
  private readonly tag: THREE.Sprite;
  private facing = 0;
  private walkPhase = Math.random() * 10;
  private photoKey = '';
  private tagKey = '';
  private avatar: AvatarId;
  private name = '';

  constructor(
    private readonly rapier: R,
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    avatar: AvatarId,
    x: number,
    z: number,
  ) {
    this.avatar = avatar;
    const style = avatarById(avatar);
    const bodyMat = () => {
      const m = new THREE.MeshStandardMaterial({ color: style.body, metalness: 0.55, roughness: 0.35 });
      this.bodyMats.push(m);
      return m;
    };
    const accentMat = () => {
      const m = new THREE.MeshStandardMaterial({ color: style.accent, metalness: 0.3, roughness: 0.5 });
      this.accentMats.push(m);
      return m;
    };
    this.eyeMat = new THREE.MeshStandardMaterial({ color: style.eye, emissive: style.eye, emissiveIntensity: 1.4 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1b1b28', metalness: 0.4, roughness: 0.6 });

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // barrel torso with accent rings
    add(this.visual, new THREE.CylinderGeometry(0.46, 0.42, 0.95, 20), bodyMat(), 0, 0, 0);
    add(this.visual, new THREE.TorusGeometry(0.46, 0.045, 8, 24), accentMat(), 0, 0.42, 0).rotation.x = Math.PI / 2;
    add(this.visual, new THREE.TorusGeometry(0.43, 0.045, 8, 24), accentMat(), 0, -0.42, 0).rotation.x = Math.PI / 2;

    // chest screen with the player's photo
    add(this.visual, new THREE.BoxGeometry(0.62, 0.62, 0.06), dark, 0, 0.02, 0.43);
    this.screenMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.54), this.screenMat);
    screen.position.set(0, 0.02, 0.465);
    this.visual.add(screen);

    // head
    const head = this.head;
    head.position.y = 0.78;
    this.visual.rotation.order = 'YXZ';
    this.visual.add(head);

    // crown of the current leader
    const gold = new THREE.MeshStandardMaterial({ color: '#ffcc00', emissive: '#ffb300', emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.25 });
    this.crown.position.y = 0.95;
    add(this.crown, new THREE.CylinderGeometry(0.26, 0.3, 0.16, 12), gold);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(this.crown, new THREE.ConeGeometry(0.07, 0.2, 6), gold, Math.cos(a) * 0.24, 0.17, Math.sin(a) * 0.24);
    }
    this.crown.visible = false;
    head.add(this.crown);
    add(head, new THREE.CylinderGeometry(0.3, 0.32, 0.42, 18), bodyMat());
    add(head, new THREE.BoxGeometry(0.46, 0.14, 0.06), dark, 0, 0.03, 0.29);
    add(head, new THREE.SphereGeometry(0.065, 12, 10), this.eyeMat, -0.11, 0.03, 0.32);
    add(head, new THREE.SphereGeometry(0.065, 12, 10), this.eyeMat, 0.11, 0.03, 0.32);
    add(head, new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6), dark, 0, 0.34, 0);
    add(head, new THREE.SphereGeometry(0.07, 10, 8), this.eyeMat, 0, 0.5, 0);

    // arms
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.55, 0.3, 0);
      add(pivot, new THREE.CylinderGeometry(0.085, 0.075, 0.55, 8), accentMat(), 0, -0.27, 0);
      add(pivot, new THREE.SphereGeometry(0.11, 10, 8), bodyMat(), 0, -0.58, 0);
      this.visual.add(pivot);
      this.arms.push(pivot);
    }

    // legs
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.2, -0.45, 0);
      add(pivot, new THREE.CylinderGeometry(0.11, 0.1, 0.42, 8), dark, 0, -0.21, 0);
      add(pivot, new THREE.BoxGeometry(0.24, 0.12, 0.34), bodyMat(), 0, -0.48, 0.05);
      this.visual.add(pivot);
      this.legs.push(pivot);
    }

    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.tag.scale.set(2.5, 0.82, 1);
    this.tag.position.y = 1.85;
    this.tag.renderOrder = 10;

    this.fxSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.fxSprite.scale.set(2.2, 0.77, 1);
    this.fxSprite.position.y = 2.7;
    this.fxSprite.renderOrder = 11;
    this.fxSprite.visible = false;

    // power-up props
    this.icicles.visible = false;
    this.visual.add(this.icicles);
    // shield in the left hand: the group is turned so that its face looks forward when the arm is raised
    this.shieldProp.rotation.x = 1.25;
    this.shieldProp.position.set(0, -0.72, 0.05);
    this.shieldProp.visible = false;
    this.arms[0].add(this.shieldProp);
    // money bag hanging from the right hand
    this.bagProp.rotation.x = 0.5;
    this.bagProp.position.set(0, -0.86, 0.05);
    this.bagProp.visible = false;
    this.arms[1].add(this.bagProp);
    // mini bombs orbit around the robot
    for (const b of this.bombProps) this.bombOrbit.add(b);
    this.bombOrbit.visible = false;
    this.visual.add(this.bombOrbit);
    // alarm clock above the name tag
    this.clockProp.position.y = 2.75;
    this.clockProp.rotation.x = -0.35;
    this.clockProp.visible = false;

    this.stars.position.y = 1.75;
    this.stars.visible = false;

    this.group.add(this.visual, this.tag, this.fxSprite, this.clockProp, this.stars);
    scene.add(this.group);

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(x, ROBOT_HALF_HEIGHT + 0.05, z)
        .lockRotations()
        .setLinearDamping(0.4)
        .setCcdEnabled(true),
    );
    world.createCollider(
      rapier.ColliderDesc.capsule(0.55, 0.45).setFriction(0.5).setRestitution(0).setCollisionGroups(ROBOT_COLLISION_GROUPS),
      this.body,
    );
    this.syncVisual(0);
  }

  setAvatar(avatar: AvatarId) {
    if (avatar === this.avatar) return;
    this.avatar = avatar;
    const s = avatarById(avatar);
    this.applyColors();
    this.eyeMat.color.set(s.eye);
    this.eyeMat.emissive.set(s.eye);
    if (!this.photoKey.startsWith('url:')) this.photoKey = '';
  }

  setPhoto(url: string | null, name: string) {
    const key = url ? `url:${url}` : `init:${name}:${this.avatar}`;
    if (key === this.photoKey) return;
    this.photoKey = key;
    const old = this.screenMat.map;
    if (url) {
      loader.load(url, (tex) => {
        if (this.photoKey !== key) return tex.dispose();
        tex.colorSpace = THREE.SRGBColorSpace;
        this.screenMat.map = tex;
        this.screenMat.needsUpdate = true;
        old?.dispose();
      });
    } else {
      this.screenMat.map = initialsTexture(name, avatarById(this.avatar).body);
      this.screenMat.needsUpdate = true;
      old?.dispose();
    }
  }

  setTag(name: string, score: number, delta: number | null, offline: boolean) {
    this.name = name;
    const key = `${name}|${score}|${delta}|${offline}`;
    if (key === this.tagKey) return;
    this.tagKey = key;
    const mat = this.tag.material;
    mat.map?.dispose();
    mat.map = nameTagTexture(name, score, delta, offline);
    mat.opacity = offline ? 0.6 : 1;
    mat.needsUpdate = true;
  }

  /** Crown for the player in the lead. */
  setCrown(on: boolean) {
    this.hasCrown = on;
  }

  private applyColors() {
    const s = avatarById(this.avatar);
    const tinted = (base: string) => new THREE.Color(base).lerp(this.tint.color, this.tint.amount);
    for (const m of this.bodyMats) m.color.copy(tinted(s.body));
    for (const m of this.accentMats) m.color.copy(tinted(s.accent));
  }

  /**
   * Everything that is happening to this robot because of power-ups: ice (blue, icicles, shivering), slime (green,
   * squelching), bombs circling around it, a clock above it, a shield or a money bag in its hands, a rocket sign.
   */
  setLoadout(effects: PowerupType[], shield: boolean, bet: boolean) {
    const key = `${effects.join(',')}|${shield}|${bet}`;
    if (key === this.fxKey) return;
    this.fxKey = key;
    this.frozen = effects.includes('freeze');
    this.slimy = effects.includes('slime');
    this.hasShield = shield;
    this.hasBag = bet;
    this.icicles.visible = this.frozen;
    this.shieldProp.visible = shield;
    this.bagProp.visible = bet;
    this.bombOrbit.visible = effects.includes('bombs');
    this.clockProp.visible = effects.includes('reduce_time');
    if (this.frozen) this.tint = { color: new THREE.Color('#58b4ff'), amount: 0.6 };
    else if (this.slimy) this.tint = { color: new THREE.Color('#37d94f'), amount: 0.65 };
    else this.tint = { color: new THREE.Color('#ffffff'), amount: 0 };
    this.applyColors();
    for (const m of this.bodyMats) {
      m.emissive.set(this.frozen ? '#3a8fff' : this.slimy ? '#1f9a35' : '#000000');
      m.emissiveIntensity = this.frozen ? 0.45 : this.slimy ? 0.35 : 0;
    }
    // only the catapult has no model of its own: a rocket sign above the head
    const sign = effects.includes('catapult') ? POWERUPS.catapult.icon : '';
    const mat = this.fxSprite.material;
    mat.map?.dispose();
    mat.map = sign ? emojiTexture(sign) : null;
    mat.needsUpdate = true;
    this.fxSprite.visible = sign !== '';
  }

  /** Catapult: the robot is shot at the host screen, smashes into it and slowly slides down. */
  launch(camera: THREE.Camera) {
    const p = this.body.translation();
    this.script = {
      t: 0,
      cam: camera,
      start: new THREE.Vector3(p.x, p.y, p.z),
      // camera space: x right, y up, -z forward. The robot hits the "glass" in front of the lens.
      local: new THREE.Vector3((Math.random() - 0.5) * 2.4, 0.2 + Math.random() * 0.4, -5.4),
      cat: new Catapult(),
      built: false,
      launched: false,
      hit: false,
    };
    // the catapult stands at the robot's feet, turned so that we see it in profile (it throws towards the camera side)
    this.script.cat.group.position.set(p.x, 0, p.z);
    this.script.cat.group.rotation.y = -Math.PI / 4;
    this.script.cat.setBuild(0);
    this.scene.add(this.script.cat.group);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setEnabled(false);
    this.target = null;
    this.celebrating = false;
    this.mood = 'idle';
    this.nervous = false;
    this.shakingOff = false;
    this.offscreen = false;
  }

  /** Turn to look at a point on the floor. */
  faceTowards(x: number, z: number) {
    const p = this.body.translation();
    this.facing = Math.atan2(x - p.x, z - p.z);
  }

  /** What the robot holds in its hand (an attacker's power-up on the way to the target). */
  setHeldItem(type: PowerupType | null) {
    if (type === this.heldType) return;
    if (this.held) {
      this.arms[1].remove(this.held);
      this.held = null;
    }
    this.heldType = type;
    const item = type ? makeHandItem(type) : null;
    if (item) {
      item.position.set(0, -0.72, 0.14);
      this.arms[1].add(item);
      this.held = item;
    }
  }

  /** A short action with the right arm: a slap, or handing something over. `onHit` fires at the moment of contact. */
  doAct(kind: 'slap' | 'give', onHit?: () => void) {
    this.act = { kind, t: 0, dur: kind === 'slap' ? 0.7 : 0.8, hitAt: kind === 'slap' ? 0.34 : 0.3, onHit, hit: false };
  }

  /** Thrown back by a blow. */
  knock(dx: number, dz: number, power = 4.5) {
    this.body.setLinvel({ x: dx * power, y: 3.2, z: dz * power }, true);
  }

  /** Dizzy: stars circle above the head, the robot staggers. */
  setDizzy(seconds: number) {
    this.dizzyT = seconds;
    this.stars.visible = seconds > 0;
  }

  get scripted() {
    return this.script !== null;
  }

  private endScript() {
    if (!this.script && !this.offscreen) return;
    this.script?.cat.dispose(this.scene);
    this.script = null;
    this.offscreen = false;
    this.body.setEnabled(true);
    this.group.quaternion.identity();
    this.visual.rotation.set(0, 0, 0);
    this.visual.scale.set(1, 1, 1);
    this.visual.position.set(0, 0, 0);
    this.tag.visible = true;
  }

  /** Little hop of joy (e.g. "answer locked in"). */
  hop(power = 5) {
    this.jump(power);
    const p = this.body.translation();
    this.onEvent?.({ type: 'hop', x: p.x, y: p.y, z: p.z, power: 0.5 });
  }

  get position() {
    return this.body.translation();
  }

  teleport(x: number, y: number, z: number) {
    this.endScript();
    this.body.setTranslation({ x, y, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.target = null;
    this.fallen = false;
    this.dropping = false;
    this.celebrating = false;
  }

  runTo(x: number, z: number) {
    this.target = new THREE.Vector3(x, 0, z);
    this.celebrating = false;
  }

  jump(power = 7.5) {
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x * 0.3, y: power, z: v.z * 0.3 }, true);
  }

  /** Turn the body to an absolute angle (0 = towards the camera). */
  setFacing(angle: number) {
    this.facing = angle;
  }

  faceCamera() {
    this.facing = 0;
  }

  update(dt: number, time: number) {
    if (this.script) {
      this.runScript(dt, time);
      return;
    }
    const v = this.body.linvel();
    if (this.dropping) {
      this.body.setLinvel({ x: 0, y: Math.min(v.y, 0), z: 0 }, true);
    } else if (this.target) {
      const p = this.body.translation();
      const dx = this.target.x - p.x;
      const dz = this.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.15) {
        const speed = this.runSpeed * Math.min(1, 0.35 + dist / 1.5);
        this.body.setLinvel({ x: (dx / dist) * speed, y: v.y, z: (dz / dist) * speed }, true);
        this.facing = Math.atan2(dx, dz);
      } else {
        this.body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
        this.target = null;
        this.facing = 0;
      }
    }
    this.syncVisual(dt, time);
  }

  private runScript(dt: number, time: number) {
    const s = this.script!;
    s.t += dt;
    const { build, tension, swing, flight, stick, slide } = CATAPULT;
    const tSwing = build + tension;
    const tRelease = tSwing + swing;
    s.cam.updateMatrixWorld();
    this.tag.visible = false;
    this.fxSprite.visible = false;
    this.visual.rotation.order = 'YXZ';
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const cup = new THREE.Vector3();

    if (s.t < tRelease) {
      if (!s.built) {
        s.built = true;
        this.onEvent?.({ type: 'build', x: s.start.x, y: 0.2, z: s.start.z, power: 1 });
      }
      // 1) the catapult pops up under the robot, 2) the arm is cranked back, 3) the arm swings
      let angle: number;
      if (s.t < build) {
        const k = s.t / build;
        angle = lerp(ARM.rest, ARM.loaded, k);
        s.cat.setBuild(k);
      } else if (s.t < tSwing) {
        angle = lerp(ARM.loaded, ARM.tense, (s.t - build) / tension) + Math.sin(time * 70) * 0.012;
        s.cat.setBuild(1);
      } else {
        const u = (s.t - tSwing) / swing;
        angle = lerp(ARM.tense, ARM.release, u * u);
      }
      s.cat.setArm(angle);
      s.cat.cupWorld(cup);
      const seat = cup.clone().add(new THREE.Vector3(0, 1.0, 0));
      if (s.t < build) {
        // the robot hops from its spot into the cup
        const k = Math.min(1, Math.max(0, (s.t - build * 0.35) / (build * 0.65)));
        this.group.position.copy(s.start).lerp(seat, k * k * (3 - 2 * k));
        this.group.position.y += Math.sin(Math.PI * k) * 1.8;
      } else {
        this.group.position.copy(seat);
      }
      this.group.quaternion.identity();
      // sits in the cup facing the viewer, holding on and shaking while the arm is cranked back
      const tense = s.t >= build && s.t < tSwing ? (s.t - build) / tension : 0;
      this.visual.rotation.set(0, 0, 0);
      this.visual.scale.set(1, 1, 1);
      this.visual.position.x = Math.sin(time * 80) * 0.05 * tense;
      this.arms[0].rotation.set(0, 0, -2.2 + Math.sin(time * 40) * 0.15 * tense);
      this.arms[1].rotation.set(0, 0, 2.2 - Math.sin(time * 40) * 0.15 * tense);
      this.legs[0].rotation.x = this.legs[1].rotation.x = -0.9;
      this.head.rotation.set(0, 0, Math.sin(time * 35) * 0.1 * tense);
      return;
    }

    if (!s.launched) {
      // release: the flight starts where the cup is
      s.launched = true;
      s.cat.cupWorld(cup);
      s.start.copy(cup).add(new THREE.Vector3(0, 1.0, 0));
      this.onEvent?.({ type: 'launch', x: s.start.x, y: s.start.y, z: s.start.z, power: 1 });
    }
    // the arm keeps swinging after the release and settles
    const after = s.t - tRelease;
    s.cat.setArm(lerp(ARM.release, ARM.after, 1 - Math.exp(-after * 7)) + Math.sin(after * 22) * 0.07 * Math.exp(-after * 3));

    if (s.t < tRelease + flight) {
      // flight: accelerates towards the camera, tumbling
      const u = (s.t - tRelease) / flight;
      const end = s.cam.localToWorld(s.local.clone());
      const pos = s.start.clone().lerp(end, u * u);
      pos.y += Math.sin(Math.PI * u) * 3 * (1 - u);
      this.group.position.copy(pos);
      this.group.quaternion.copy(s.cam.quaternion);
      this.visual.position.x = 0;
      this.visual.rotation.set(0, 0, u * Math.PI * 5);
      this.visual.scale.set(0.9, 1.18, 0.9);
      this.arms[0].rotation.z = -2.6 + Math.sin(time * 30) * 0.4;
      this.arms[1].rotation.z = 2.6 - Math.sin(time * 30) * 0.4;
      this.legs[0].rotation.x = Math.sin(time * 25) * 0.9;
      this.legs[1].rotation.x = -Math.sin(time * 25) * 0.9;
      return;
    }

    // impact: pinned flat against the screen, then sliding down
    const world = s.cam.localToWorld(s.local.clone());
    if (!s.hit) {
      s.hit = true;
      this.onEvent?.({ type: 'impact', x: world.x, y: world.y, z: world.z, power: 1 });
    }
    const v = s.t - tRelease - flight;
    const local = s.local.clone();
    const wobble = Math.max(0, 1 - v / 0.5) * Math.sin(v * 40) * 0.08;
    if (v > stick) {
      const q = (v - stick) / slide;
      local.y -= q * q * 3.6 + q * 0.5; // gravity takes over slowly
      local.x += Math.sin(q * 16) * 0.05;
      if (local.y < -3.7) {
        this.offscreen = true;
        this.fallen = true;
        s.cat.dispose(this.scene);
        this.script = null; // finished: stays hidden until it respawns
        return;
      }
    }
    this.group.position.copy(s.cam.localToWorld(local));
    this.group.quaternion.copy(s.cam.quaternion);
    this.visual.position.x = 0;
    this.visual.rotation.set(0, 0, 0.12 + wobble);
    this.visual.scale.set(1.15 + wobble, 1.15 - wobble, 0.28);
    // spread like a star, legs dangling
    this.arms[0].rotation.set(0, 0, -2.3 + Math.sin(v * 3) * 0.1);
    this.arms[1].rotation.set(0, 0, 2.3 - Math.sin(v * 3) * 0.1);
    this.legs[0].rotation.x = 0.1;
    this.legs[1].rotation.x = -0.1;
    this.head.rotation.set(0.15, 0, Math.sin(v * 2) * 0.12);
  }

  private syncVisual(dt: number, time = 0) {
    const p = this.body.translation();
    const v = this.body.linvel();
    this.group.position.set(p.x, p.y, p.z);

    if (this.spin) {
      this.visual.rotation.y += dt * 9;
    } else {
      let d = this.facing - this.visual.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.visual.rotation.y += d * Math.min(1, dt * 10);
    }

    const hs = Math.hypot(v.x, v.z);
    const airborne = Math.abs(v.y) > 2.5;
    const tumbling = this.dropping && v.y < -1;

    // landing impact: squash + dust ring (events are consumed by the arena)
    if (this.prevVy < -6 && v.y > this.prevVy + 4 && p.y > -1) {
      const power = Math.min(1, -this.prevVy / 14);
      this.squash = power;
      this.onEvent?.({ type: 'land', x: p.x, y: p.y, z: p.z, power });
    }
    this.prevVy = v.y;
    this.squash = Math.max(0, this.squash - dt * 4);
    const stretch = v.y > 4 ? Math.min(0.18, v.y * 0.02) : 0;
    this.visual.scale.set(1 + this.squash * 0.18 - stretch * 0.5, 1 - this.squash * 0.28 + stretch, 1 + this.squash * 0.18 - stretch * 0.5);

    // running dust
    if (hs > 3 && !airborne && p.y > -0.5) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.07;
        this.onEvent?.({ type: 'step', x: p.x - (v.x / hs) * 0.3, y: 0.05, z: p.z - (v.z / hs) * 0.3, power: Math.min(1, hs / 6), slimy: this.slimy });
      }
    }

    this.walkPhase += dt * (4 + hs * 2.2);
    const swing = Math.min(1, hs / 3) * 0.75;
    this.legs[0].rotation.x = Math.sin(this.walkPhase) * swing;
    this.legs[1].rotation.x = -Math.sin(this.walkPhase) * swing;

    // lean into the run, tumble while falling through a trapdoor
    const targetLean = hs > 3 && !airborne ? 0.22 : 0;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 8);
    if (tumbling) {
      this.tumbleX += dt * 4;
      this.tumbleZ += dt * 7;
      this.visual.rotation.x = this.tumbleX;
      this.visual.rotation.z = this.tumbleZ;
    } else {
      this.tumbleX = this.tumbleZ = 0;
      this.visual.rotation.x = this.lean;
      this.visual.rotation.z += (0 - this.visual.rotation.z) * Math.min(1, dt * 10);
    }

    // head: look around while standing, then mood overrides
    this.head.rotation.set(0, hs < 0.5 && !tumbling ? Math.sin(time * 0.8 + this.phase) * 0.35 : 0, 0);

    if (this.act) {
      // swing with the right arm: wind up (arm raised back), whip forward, recover
      const a = this.act;
      a.t += dt;
      const wind = a.kind === 'slap' ? 0.22 : 0.1;
      let rx: number;
      let rz: number;
      if (a.t < wind) {
        const k = a.t / wind;
        rx = 0.6 * k;
        rz = a.kind === 'slap' ? 2.4 * k : 0.2;
      } else if (a.t < a.hitAt) {
        const k = (a.t - wind) / (a.hitAt - wind);
        rx = 0.6 - 2.2 * k * k;
        rz = a.kind === 'slap' ? 2.4 - 2.0 * k * k : 0.2;
      } else {
        const k = Math.min(1, (a.t - a.hitAt) / (a.dur - a.hitAt));
        rx = a.kind === 'slap' ? -1.6 * (1 - k) : -1.4;
        rz = 0.4 * (1 - k);
      }
      if (!a.hit && a.t >= a.hitAt) {
        a.hit = true;
        a.onHit?.();
      }
      this.arms[1].rotation.set(rx, 0, rz);
      this.arms[0].rotation.set(0.2, 0, 0.3);
      this.visual.rotation.z += a.kind === 'slap' ? Math.sin(Math.min(1, a.t / a.hitAt) * Math.PI) * -0.12 : 0;
      if (a.t >= a.dur) this.act = null;
    } else if (this.celebrating) {
      const wave = Math.sin(time * 12) * 0.4;
      this.arms[0].rotation.z = -2.6 + wave;
      this.arms[1].rotation.z = 2.6 - wave;
      this.arms[0].rotation.x = this.arms[1].rotation.x = 0;
      this.head.rotation.z = Math.sin(time * 10) * 0.12;
    } else if (this.mood === 'scared') {
      this.arms[0].rotation.z = -2.4 + Math.sin(time * 40) * 0.15;
      this.arms[1].rotation.z = 2.4 - Math.sin(time * 40) * 0.15;
      this.arms[0].rotation.x = this.arms[1].rotation.x = 0;
      this.head.rotation.y = Math.sin(time * 30) * 0.3;
    } else if (this.mood === 'clap') {
      // applauding: arms in front, hands banging together to the beat
      const c = (Math.sin(time * 13 + this.phase) * 0.5 + 0.5) * 0.55;
      this.arms[0].rotation.set(-1.3, 0, 0.62 - c);
      this.arms[1].rotation.set(-1.3, 0, -0.62 + c);
      this.head.rotation.x = Math.sin(time * 6.5 + this.phase) * 0.08;
    } else if (this.mood === 'sad') {
      this.arms[0].rotation.set(0.25, 0, 0.05);
      this.arms[1].rotation.set(0.25, 0, -0.05);
      this.head.rotation.x = 0.45;
    } else if (this.mood === 'think' && hs < 0.5) {
      this.arms[0].rotation.set(0, 0, 0.12);
      this.arms[1].rotation.set(-2.1, 0, -0.4);
      this.head.rotation.z = Math.sin(time * 1.8 + this.phase) * 0.2;
    } else if (airborne && v.y < -2.5) {
      this.arms[0].rotation.z = -2.2 + Math.sin(time * 25) * 0.5;
      this.arms[1].rotation.z = 2.2 - Math.sin(time * 25) * 0.5;
    } else {
      this.arms[0].rotation.z = 0.12;
      this.arms[1].rotation.z = -0.12;
      this.arms[0].rotation.x = -Math.sin(this.walkPhase) * swing;
      this.arms[1].rotation.x = Math.sin(this.walkPhase) * swing;
    }

    // --- power-up loadout: poses and animated props
    if (!this.celebrating && !tumbling) {
      if (this.frozen) {
        // hugging itself, teeth chattering
        this.arms[0].rotation.set(-0.7, 0, 0.95);
        this.arms[1].rotation.set(-0.7, 0, -0.95);
        this.head.rotation.x = Math.sin(time * 40 + this.phase) * 0.07;
      } else if (this.slimy && this.shakingOff) {
        // tries to fling the slime off
        this.arms[0].rotation.set(Math.sin(time * 16) * 1.2, 0, 0.5);
        this.arms[1].rotation.set(Math.sin(time * 16 + 2.4) * 1.2, 0, -0.5);
        this.visual.rotation.z = Math.sin(time * 11 + this.phase) * 0.14;
      }
      if (this.hasShield) this.arms[0].rotation.set(-1.25, 0, 0.1);
      if (this.hasBag) this.arms[1].rotation.set(-0.5 + Math.sin(time * 3 + this.phase) * 0.06, 0, -0.12);
    }
    if (this.frozen) this.visual.rotation.z += Math.sin(time * 50 + this.phase) * 0.035;
    // carrying an item to the target: arm raised in front
    if (this.heldType && !this.act && !tumbling) this.arms[1].rotation.set(-0.9, 0, 0.35);
    // dizzy after a slap
    if (this.dizzyT > 0) {
      this.dizzyT -= dt;
      this.stars.visible = this.dizzyT > 0;
      this.head.rotation.z += Math.sin(time * 8) * 0.28;
      this.visual.rotation.z += Math.sin(time * 5) * 0.1;
      this.stars.children.forEach((s, i) => {
        const a = time * 5 + (i / this.stars.children.length) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.6, Math.sin(time * 6 + i) * 0.08, Math.sin(a) * 0.6);
        s.rotation.y = a;
        s.rotation.z = time * 3;
      });
    }
    if (this.bombOrbit.visible) {
      this.bombProps.forEach((b, i) => {
        const a = time * 2.4 + (i / this.bombProps.length) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.95, 0.15 + i * 0.32 + Math.sin(time * 3 + i) * 0.18, Math.sin(a) * 0.95);
        b.rotation.y = a;
        const spark = b.getObjectByName('spark');
        if (spark) spark.scale.setScalar(0.17 + Math.random() * 0.1);
      });
    }
    if (this.clockProp.visible) {
      const hour = this.clockProp.getObjectByName('hour');
      const minute = this.clockProp.getObjectByName('minute');
      if (hour) hour.rotation.z = -time * 0.4;
      if (minute) minute.rotation.z = -time * 5;
      this.clockProp.rotation.z = Math.sin(time * 9) * 0.07;
    }
    this.fxSprite.position.y = this.clockProp.visible ? 3.5 : 2.7;

    // particles for the host: frosty breath, dripping slime (events consumed by the arena)
    if (this.frozen || this.slimy) {
      this.fxTimer -= dt;
      if (this.fxTimer <= 0) {
        const shaking = this.slimy && this.shakingOff;
        this.fxTimer = this.frozen ? 0.7 : shaking ? 0.09 : 0.5;
        this.onEvent?.({ type: this.frozen ? 'breath' : 'drip', x: p.x, y: p.y + (this.frozen ? 0.9 : 0.4), z: p.z, power: shaking ? 1 : 0.3 });
      }
    }

    const shiver = this.frozen ? Math.sin(time * 65 + this.phase) * 0.05 : 0;
    const stagger = this.dizzyT > 0 ? Math.sin(time * 6) * 0.1 : 0;
    const jitter = stagger + shiver + (this.nervous ? Math.sin(time * 55 + this.phase) * 0.035 : this.mood === 'scared' ? Math.sin(time * 45) * 0.05 : 0);
    this.visual.position.x = jitter;
    this.visual.position.y = hs > 0.5 && !airborne ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(time * 2 + this.walkPhase) * 0.015;

    this.crown.visible = this.hasCrown;
    if (this.hasCrown) {
      this.crown.rotation.y += dt * 2.2;
      this.crown.position.y = 0.95 + Math.sin(time * 3 + this.phase) * 0.05;
    }
    if (this.fxSprite.visible) {
      this.fxSprite.position.y = 2.7 + Math.sin(time * 3 + this.phase) * 0.1;
      const k = 1 + Math.sin(time * 5 + this.phase) * 0.05;
      this.fxSprite.scale.set(2.2 * k, 0.77 * k, 1);
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.world.removeRigidBody(this.body);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.screenMat.map?.dispose();
    this.tag.material.map?.dispose();
    this.fxSprite.material.map?.dispose();
  }

  get displayName() {
    return this.name;
  }
}
