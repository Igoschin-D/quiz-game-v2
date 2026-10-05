import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GAME_CONFIG, POWERUPS, THEME, type Phase, type PowerupEvent, type PowerupType, type PublicPlayer, type RoomState } from '@quiz/shared';
import { loadRapier, type Rapier } from '../physics/rapier';
import { Robot, type RobotEvent } from '../characters/Robot';
import { Trapdoor } from '../platforms/Trapdoor';
import { sfx } from '../../ui/sound';
import { Confetti } from './Confetti';
import { Particles, Popups } from './Particles';
import { ARENA_HALF, CENTER_RADIUS, PIT_Y, centerSlot, floorSegments, platformSlot } from './layout';
import { bannerTexture, crackTexture, floorTexture, rankTexture } from './textures';
import { CameraRig, setupCamera } from '../camera/camera';

const STEP = 1 / 60;
const SKY_Y = 13;
const ITEM_COLOR: Partial<Record<PowerupType, string>> = {
  freeze: '#bfe8ff',
  slime: '#3cff5a',
  reduce_time: '#ffd54f',
  bombs: '#ff7043',
  catapult: '#ff4d4d',
  slap: '#ffe14d',
  bet: '#3dff8a',
  shield: '#58b4ff',
};

export class ArenaScene {
  private rapier!: Rapier;
  private world!: RAPIER.World;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly robots = new Map<string, Robot>();
  private platforms: Trapdoor[] = [];
  private confetti!: Confetti;
  private dust!: Particles;
  private sparks!: Particles;
  private popups!: Popups;
  private shake = 0;
  private rig!: CameraRig;
  // 3D podium of the finale (hidden and without colliders until the game is over)
  private podium = new THREE.Group();
  private podiumColliders: RAPIER.Collider[] = [];
  private rankSprites: THREE.Sprite[] = [];
  private lastPlayers: PublicPlayer[] = [];
  // power-up show: what has been revealed so far, who stands where in the line-up
  private shown = new Map<string, PowerupType[]>();
  private shownShield = new Set<string>();
  private shownBag = new Set<string>();
  private lineSlots = new Map<string, [number, number]>();
  private cracks: { sprite: THREE.Sprite; life: number }[] = [];
  private phase: Phase = 'LOBBY';
  private answered = new Map<string, boolean>();
  private questionEndsAt: number | null = null;
  private clockOffset = 0;
  private accumulator = 0;
  private raf = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private lastKey = '';
  private timers: { at: number; fn: () => void }[] = [];
  private paused = false;
  private pending: RoomState | null = null;
  private ready = false;
  private time = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly roomId: string,
    private readonly closeUp = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.className = 'arena-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera = setupCamera(this.closeUp);
    this.rig = new CameraRig(this.camera, this.closeUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  async init() {
    this.rapier = await loadRapier();
    if (this.disposed) return;
    this.world = new this.rapier.World({ x: 0, y: -22, z: 0 });
    this.buildEnvironment();
    this.buildPodium();
    for (let i = 0; i < 4; i++) this.platforms.push(new Trapdoor(this.rapier, this.world, this.scene, i));
    this.confetti = new Confetti(this.scene);
    this.dust = new Particles(this.scene, 700, 0.9, -1.5);
    this.sparks = new Particles(this.scene, 500, 0.5, -7);
    this.popups = new Popups(this.scene);
    this.ready = true;
    if (this.pending) this.applyState(this.pending);
    this.clock.start();
    this.loop();
  }

  // -------------------------------------------------------------- state sync

  applyState(st: RoomState) {
    if (!this.ready) {
      this.pending = st;
      return;
    }
    this.paused = st.paused;
    this.phase = st.phase;
    this.clockOffset = st.serverNow - Date.now();
    this.questionEndsAt = st.phase === 'QUESTION' ? st.phaseEndsAt : null;
    this.syncPlayers(st.players);
    this.reactToAnswers(st);
    // while players are answering the platforms carry no text: the question is read on the phones only
    const answers = st.phase === 'QUESTION' ? ['', '', '', ''] : (st.question?.answers ?? ['', '', '', '']);
    this.platforms.forEach((p, i) => p.setAnswer(answers[i] ?? ''));

    const key = `${st.phase}:${st.questionIndex}:${st.introIndex}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.onPhase(st.phase, st);
    }
  }

  /** Players who lock in an answer hop for joy (and the host hears a pop). */
  private reactToAnswers(st: RoomState) {
    for (const p of st.players) {
      const was = this.answered.get(p.id) ?? false;
      this.answered.set(p.id, p.answered);
      if (st.phase !== 'QUESTION' || !p.answered || was) continue;
      const robot = this.robots.get(p.id);
      if (!robot) continue;
      robot.mood = 'idle';
      robot.hop();
    }
  }

  /** A viewer reaction from a phone: emoji floats above the robot, which hops. */
  react(playerId: string, emoji: string) {
    const robot = this.robots.get(playerId);
    if (!robot || !this.ready || this.paused) return;
    const pos = robot.position;
    if (pos.y < -1) return;
    this.popups.showEmoji(pos.x, 3.4, pos.z, emoji);
    if (Math.abs(robot.body.linvel().y) < 1) robot.jump(4);
    sfx.react();
  }

  private onRobotEvent(e: RobotEvent) {
    if (e.type === 'build') {
      // the catapult is knocked together under the robot
      this.dust.ring(e.x, e.z, 22, 5, '#c9a15f');
      this.sparks.burst(e.x, 0.6, e.z, 14, 2.5, '#c9a15f', 3);
      this.shake = Math.max(this.shake, 0.25);
      sfx.thud();
    } else if (e.type === 'launch') {
      this.sparks.burst(e.x, e.y + 0.5, e.z, 30, 3, '#ffb23d', 5);
      this.dust.ring(e.x, e.z, 16, 4, '#ffb23d');
      sfx.launch();
    } else if (e.type === 'impact') {
      this.shake = Math.max(this.shake, 1.1);
      this.sparks.burst(e.x, e.y, e.z, 60, 6, '#ffffff', 2);
      this.sparks.burst(e.x, e.y, e.z, 30, 4, '#ffcc00', 2);
      // cracks on the "glass" a bit in front of the robot, i.e. closer to the lens
      const toCam = this.camera.position.clone().sub(new THREE.Vector3(e.x, e.y, e.z)).normalize().multiplyScalar(0.5);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: crackTexture(), transparent: true, depthWrite: false, depthTest: false }));
      sprite.scale.set(4.6, 4.6, 1);
      sprite.position.set(e.x + toCam.x, e.y + toCam.y, e.z + toCam.z);
      sprite.renderOrder = 20;
      this.scene.add(sprite);
      this.cracks.push({ sprite, life: 3.8 });
      sfx.splat();
      this.later(900, () => sfx.slide());
    } else if (e.type === 'breath') {
      for (let i = 0; i < 3; i++) this.sparks.emit(e.x, e.y, e.z + 0.4, (Math.random() - 0.5) * 0.5, 0.9, 0.5 + Math.random() * 0.4, 0.9, '#bfe8ff');
    } else if (e.type === 'drip') {
      const n = e.power > 0.5 ? 4 : 1;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = e.power > 0.5 ? 2.5 + Math.random() * 2.5 : 0.3;
        this.sparks.emit(e.x, e.y + Math.random() * 0.8, e.z, Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp, 0.7, '#3cff5a');
      }
    } else if (e.type === 'step') {
      if (e.slimy) {
        this.sparks.emit(e.x, 0.1, e.z, 0, 0.8, 0, 0.5, '#3cff5a');
        sfx.squelch();
      }
      for (let i = 0; i < 2; i++) {
        this.dust.emit(e.x + (Math.random() - 0.5) * 0.3, 0.12, e.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.8, 0.7, (Math.random() - 0.5) * 0.8, 0.5, '#5d58a8');
      }
    } else if (e.type === 'land') {
      this.dust.ring(e.x, e.z, 14, 3 + e.power * 4, '#8f89d8');
      if (e.power > 0.5) {
        this.shake = Math.min(0.5, Math.max(this.shake, 0.18 * e.power));
        sfx.land(e.power);
      }
    } else if (e.type === 'hop') {
      this.sparks.burst(e.x, e.y + 1.3, e.z, 10, 2.6, '#ffcc00', 4);
      sfx.hop();
    }
  }

  private syncPlayers(players: PublicPlayer[]) {
    this.lastPlayers = players;
    const seen = new Set<string>();
    players.forEach((p, i) => {
      seen.add(p.id);
      let robot = this.robots.get(p.id);
      if (!robot) {
        const [x, z] = this.slot(i, players.length);
        robot = new Robot(this.rapier, this.world, this.scene, p.avatar, x, z);
        robot.body.setTranslation({ x, y: SKY_Y + Math.random() * 2, z }, true);
        this.robots.set(p.id, robot);
      }
      robot.onEvent ??= (e) => this.onRobotEvent(e);
      robot.setAvatar(p.avatar);
      this.applyLoadout(robot, p);
      // Before the intro card the host sees an anonymous "Игрок #N" without the photo.
      robot.setPhoto(p.revealed && p.photoVersion > 0 ? `/api/rooms/${this.roomId}/photo/${p.id}?v=${p.photoVersion}` : null, p.revealed ? p.name : `${i + 1}`);
      robot.setTag(this.label(p, i), p.score, null, !p.connected && !p.isBot);
    });
    // crown for the single leader (only once points have been scored)
    const top = Math.max(0, ...players.map((p) => p.score));
    const leaders = players.filter((p) => p.score === top);
    const crownId = top > 0 && leaders.length === 1 ? leaders[0].id : null;
    for (const [id, robot] of this.robots) robot.setCrown(id === crownId && this.phase !== 'LOBBY' && this.phase !== 'INTRO');
    for (const [id, robot] of this.robots) {
      if (!seen.has(id)) {
        robot.dispose(this.scene);
        this.robots.delete(id);
      }
    }
  }

  /** Name over a robot: anonymous until revealed, plus icons of power-ups that hit the player. */
  private label(p: PublicPlayer, i: number) {
    const icons = p.effects.map((e) => POWERUPS[e].icon).join('');
    const fire = p.streak >= 2 ? ` 🔥${p.streak}` : '';
    return `${p.revealed ? p.name || 'Игрок' : `Игрок #${i + 1}`}${icons ? ` ${icons}` : ''}${fire}`;
  }

  /** During the power-up window/show only what has already been revealed on screen is displayed. */
  private applyLoadout(robot: Robot, p: PublicPlayer) {
    if (this.phase === 'POWERUPS' || this.phase === 'POWERUP_SHOW') {
      robot.setLoadout(this.shown.get(p.id) ?? [], p.shield || this.shownShield.has(p.id), this.shownBag.has(p.id));
    } else {
      robot.setLoadout(p.effects, p.shield, p.bet);
    }
  }

  private onPhase(phase: Phase, st: RoomState) {
    this.clearTimers();
    const players = st.players;
    for (const r of this.robots.values()) {
      r.mood = 'idle';
      r.nervous = false;
      r.spin = false;
      if (phase !== 'POWERUP_SHOW') {
        r.setHeldItem(null);
        r.runSpeed = 6.2;
      }
    }
    if (phase !== 'POWERUP_SHOW') this.rig.reset();
    if (phase !== 'FINAL') this.setPodium(false);
    for (const p of this.platforms) p.setSignVisible(phase !== 'FINAL');
    if (phase === 'POWERUPS') {
      this.shown.clear();
      this.shownShield.clear();
      this.shownBag.clear();
    }
    switch (phase) {
      case 'POWERUP_SHOW':
        this.startShow(st);
        break;
      case 'LOBBY':
      case 'CATEGORY':
      case 'MUTATOR':
      case 'POWERUPS':
      case 'NEXT_QUESTION':
        this.gatherInCenter(players);
        break;
      case 'QUESTION':
        this.gatherInCenter(players);
        for (const p of players) if (!p.answered) {
          const r = this.robots.get(p.id);
          if (r) r.mood = 'think';
        }
        break;
      case 'INTRO': {
        this.gatherInCenter(players);
        const robot = st.introPlayerId ? this.robots.get(st.introPlayerId) : undefined;
        if (robot) {
          [0, 600, 1200].forEach((ms) => this.later(ms, () => robot.jump(7)));
          const pos = robot.position;
          this.sparks.burst(pos.x, 1.5, pos.z, 40, 4, '#ffcc00', 6);
          sfx.reveal();
        }
        break;
      }
      case 'LOCKED':
        this.resetPlatforms();
        for (const p of players) if (p.answer !== null) this.robots.get(p.id)?.jump(4);
        break;
      case 'RUNNING':
        this.resetPlatforms();
        this.runToPlatforms(players);
        // catapulted players are shot into the screen at the moment the others run away
        for (const p of players) if (p.effects.includes('catapult')) this.robots.get(p.id)?.launch(this.camera);
        break;
      case 'REVEAL':
        this.highlight(st.correctAnswer);
        // tension: the right ones cheer, the wrong ones realise what is coming
        for (const p of players) {
          const r = this.robots.get(p.id);
          if (!r) continue;
          if (p.result === 'correct') {
            r.celebrating = true;
            r.jump(6);
            const pos = r.position;
            this.sparks.burst(pos.x, 1.6, pos.z, 14, 3, '#3dff8a', 4);
          } else if (p.result === 'wrong') r.mood = 'scared';
        }
        if (players.some((p) => p.result === 'correct')) sfx.cheer();
        if (players.some((p) => p.result === 'wrong')) this.later(500, () => sfx.gasp());
        break;
      case 'DROP':
        this.highlight(st.correctAnswer);
        this.drop(players, st.correctAnswer);
        break;
      case 'FINAL':
        this.finale(players);
        break;
    }
  }

  private resetPlatforms() {
    this.platforms.forEach((p) => {
      p.setOpen(false);
      p.setState('neutral');
    });
  }

  // -------------------------------------------------------------- power-up show

  private refreshLoadout(id: string) {
    const robot = this.robots.get(id);
    const p = this.lastPlayers.find((x) => x.id === id);
    if (robot && p) this.applyLoadout(robot, p);
  }

  /** Everybody lines up; then the used power-ups are played out one by one while the camera glides from pair to pair. */
  private startShow(st: RoomState) {
    const players = st.players;
    const events = st.powerupEvents;
    this.shown.clear();
    this.shownShield.clear();
    this.shownBag.clear();
    // a blocked attack needs the shield on the screen when it is played
    for (const ev of events) if (ev.blocked) this.shownShield.add(ev.targetId);

    const n = players.length;
    const spacing = Math.min(2.2, 32 / Math.max(1, n - 1));
    players.forEach((p, i) => {
      const slot: [number, number] = [(i - (n - 1) / 2) * spacing, 11.5];
      this.lineSlots.set(p.id, slot);
      const r = this.robots.get(p.id);
      if (!r) return;
      r.celebrating = false;
      if (r.scripted || r.offscreen || r.fallen || r.position.y < -0.5) r.teleport(slot[0], 2, slot[1]);
      else r.runTo(slot[0], slot[1]);
    });
    this.rig.focus(new THREE.Vector3(0, 12.5, 27), new THREE.Vector3(0, 1, 10));
    sfx.whoosh();

    const lineup = GAME_CONFIG.SHOW_LINEUP_SECONDS;
    const per = GAME_CONFIG.SHOW_EVENT_SECONDS;
    const played = events.slice(0, GAME_CONFIG.SHOW_MAX_EVENTS);
    // the ones that do not fit into the show still take effect (silently)
    for (const ev of events.slice(GAME_CONFIG.SHOW_MAX_EVENTS)) this.revealEvent(ev, false);
    played.forEach((ev, i) => this.later((lineup + i * per) * 1000, () => this.playEvent(ev)));
    this.later((lineup + played.length * per) * 1000, () => this.rig.focus(new THREE.Vector3(0, 12.5, 27), new THREE.Vector3(0, 1, 10)));
  }

  /** The effect of a power-up becomes visible on its target. */
  private revealEvent(ev: PowerupEvent, withFx: boolean) {
    const target = this.robots.get(ev.targetId);
    if (ev.type === 'shield') this.shownShield.add(ev.attackerId);
    else if (ev.type === 'bet') this.shownBag.add(ev.attackerId);
    else if (ev.type !== 'slap' && !ev.blocked) this.shown.set(ev.targetId, [...(this.shown.get(ev.targetId) ?? []), ev.type]);
    this.refreshLoadout(ev.targetId);
    this.refreshLoadout(ev.attackerId);
    if (withFx && target) {
      const pos = target.position;
      this.sparks.burst(pos.x, 1.4, pos.z, 26, 4, ITEM_COLOR[ev.type] ?? '#ffffff', 4);
    }
  }

  private playEvent(ev: PowerupEvent) {
    const A = this.robots.get(ev.attackerId);
    const T = this.robots.get(ev.targetId);
    if (!A || !T) return;
    const a = A.position;
    const t = T.position;
    const color = ITEM_COLOR[ev.type] ?? '#ffffff';
    const self = ev.attackerId === ev.targetId;
    const focus = (x: number, z: number, near: number) =>
      this.rig.focus(new THREE.Vector3(x, 6.5 * near + 1, z + 9.5 * near + 1), new THREE.Vector3(x, 1.2, z));

    if (self) {
      // shield (or a bet on oneself): the robot shows it off
      focus(a.x, a.z, 0.75);
      this.later(700, () => {
        this.revealEvent(ev, true);
        this.sparks.burst(a.x, 1.6, a.z, 30, 3.5, color, 5);
        this.popups.show(a.x, 3.3, a.z, ev.type === 'shield' ? 'ЩИТ!' : '💰', '#58b4ff');
        A.jump(5);
        sfx[ev.type === 'shield' ? 'shield' : 'pickup']();
      });
      return;
    }

    const midX = (a.x + t.x) / 2;
    const midZ = (a.z + t.z) / 2;
    const span = Math.hypot(a.x - t.x, a.z - t.z);
    focus(midX, midZ, 0.75 + Math.min(1.1, span / 12));
    sfx.whoosh();

    // the attacker grabs the item and sprints to the target
    A.setHeldItem(ev.type);
    const side = a.x < t.x ? -1 : 1;
    const spotX = t.x + side * 1.5;
    const spotZ = t.z;
    const dist = Math.hypot(spotX - a.x, spotZ - a.z);
    const travel = Math.min(1.5, Math.max(0.5, dist / 11));
    A.runSpeed = Math.min(22, dist / (travel * 0.8));
    A.runTo(spotX, spotZ);

    this.later((travel + 0.25) * 1000, () => {
      A.runSpeed = 6.2;
      A.faceTowards(t.x, t.z);
      T.faceTowards(a.x, a.z);
      const giving = ev.type === 'bet';
      A.doAct(giving ? 'give' : 'slap', () => {
        const p = T.position;
        const dir = Math.sign(p.x - spotX) || 1;
        A.setHeldItem(giving ? 'bet' : null);
        if (ev.type === 'slap') {
          T.knock(dir, 0, 5);
          T.setDizzy(5);
          this.sparks.burst(p.x, 2.2, p.z, 28, 4, '#ffe14d', 5);
          this.popups.show(p.x, 3.4, p.z, 'ШЛЁП!', '#ffcc00');
          this.shake = Math.max(this.shake, 0.35);
          sfx.slap();
          this.later(150, () => sfx.dizzy());
        } else if (giving) {
          this.revealEvent(ev, true);
          this.popups.showEmoji(p.x, 3.2, p.z, '💰');
          sfx.pickup();
        } else if (ev.blocked) {
          this.sparks.burst(p.x, 1.4, p.z, 30, 5, '#58b4ff', 3);
          this.popups.show(p.x, 3.4, p.z, 'ЩИТ!', '#58b4ff');
          A.knock(-dir, 0, 4);
          this.shake = Math.max(this.shake, 0.25);
          sfx.shield();
          this.later(900, () => {
            this.shownShield.delete(ev.targetId);
            this.refreshLoadout(ev.targetId);
          });
        } else {
          T.knock(dir, 0, 3);
          this.revealEvent(ev, true);
          this.popups.showEmoji(p.x, 3.4, p.z, POWERUPS[ev.type].icon);
          this.shake = Math.max(this.shake, 0.3);
          sfx.slap();
          if (ev.type === 'freeze') this.later(120, () => sfx.freeze());
          else if (ev.type === 'slime') this.later(120, () => sfx.squelch());
          else if (ev.type === 'bombs') this.later(120, () => sfx.explosion());
          else this.later(120, () => sfx.powerup());
        }
        // back to the place in the line
        this.later(900, () => {
          const slot = this.lineSlots.get(ev.attackerId);
          if (slot) {
            A.runSpeed = 12;
            A.runTo(slot[0], slot[1]);
          }
          A.setHeldItem(null);
        });
      });
    });
  }

  /** Start-circle slot of a player (the /gallery close-up lines everybody up in a row instead). */
  private slot(i: number, n: number): [number, number] {
    return this.closeUp ? [(i - (n - 1) / 2) * 2.1, 0.5] : centerSlot(i);
  }

  /** Robots that fell drop from the sky into the start circle; everyone else walks back. */
  private gatherInCenter(players: PublicPlayer[]) {
    this.resetPlatforms();
    players.forEach((p, i) => {
      const robot = this.robots.get(p.id);
      if (!robot) return;
      robot.celebrating = false;
      robot.setTag(this.label(p, i), p.score, null, !p.connected && !p.isBot);
      const [x, z] = this.slot(i, players.length);
      const pos = robot.position;
      if (robot.scripted || robot.offscreen || robot.fallen || robot.dropping || pos.y < -0.5) {
        robot.teleport(x, SKY_Y + (i % 3) * 1.5, z);
      } else if (Math.hypot(pos.x - x, pos.z - z) > 0.3) {
        robot.runTo(x, z);
      }
    });
  }

  private highlight(correct: number | null) {
    this.platforms.forEach((p, i) => p.setState(correct === null ? 'neutral' : i === correct ? 'correct' : 'wrong'));
  }

  private runToPlatforms(players: PublicPlayer[]) {
    const groups: PublicPlayer[][] = [[], [], [], []];
    for (const p of players) if (p.answer !== null && p.answer >= 0 && p.answer < 4) groups[p.answer].push(p);
    groups.forEach((group, platform) =>
      group.forEach((p, k) => {
        const [x, z] = platformSlot(platform, k, group.length);
        this.robots.get(p.id)?.runTo(x, z);
      }),
    );
  }

  private drop(players: PublicPlayer[], correct: number | null) {
    const winners: [number, number][] = [];
    for (const [i, p] of players.entries()) {
      const robot = this.robots.get(p.id);
      if (!robot) continue;
      robot.setTag(this.label(p, i), p.score, p.lastDelta, !p.connected && !p.isBot);
      robot.target = null;
      if (p.result === 'correct') {
        robot.celebrating = true;
        const pos = robot.position;
        winners.push([pos.x, pos.z]);
        [0, 650, 1300].forEach((ms) => this.later(ms, () => robot.jump(7)));
      } else if (p.result === 'wrong') {
        robot.dropping = true;
        robot.fallen = true;
        robot.mood = 'idle';
      }
    }
    this.platforms.forEach((p, i) => p.setOpen(correct !== null && i !== correct));
    this.shake = Math.max(this.shake, 0.45);
    for (const p of players) {
      const r = this.robots.get(p.id);
      if (!r) continue;
      const pos = r.position;
      if (p.result === 'correct' && p.lastDelta > 0) {
        this.popups.show(pos.x, 3.2, pos.z, `+${p.lastDelta}${p.streak >= 3 ? ' 🔥' : ''}`);
      } else if (p.lastDelta < 0) {
        this.popups.show(pos.x, 3.2, pos.z, `−${Math.abs(p.lastDelta)}`, '#ff6b6b');
      }
    }
    this.confetti.burst(winners);
    this.later(2800, () => this.platforms.forEach((p) => p.setOpen(false)));
  }

  private buildPodium() {
    const specs: { rank: number; x: number; h: number; color: string }[] = [
      { rank: 1, x: 0, h: 3.2, color: '#ffcc33' },
      { rank: 2, x: -3.9, h: 2.2, color: '#cfd8e3' },
      { rank: 3, x: 3.9, h: 1.5, color: '#cd7f32' },
    ];
    const W = 3.6;
    const D = 3.2;
    // round stage under the podium
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.6, 0.3, 48), new THREE.MeshStandardMaterial({ color: '#2a1f66', roughness: 0.6, metalness: 0.2 }));
    stage.position.set(0, 0.15, -3);
    stage.receiveShadow = true;
    this.podium.add(stage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.2, 0.12, 8, 64), new THREE.MeshStandardMaterial({ color: '#ffcc00', emissive: '#ffb300', emissiveIntensity: 0.8 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.32, -3);
    this.podium.add(ring);
    for (const s of specs) {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(W, s.h, D),
        new THREE.MeshStandardMaterial({ color: s.color, metalness: 0.55, roughness: 0.3, emissive: s.color, emissiveIntensity: 0.12 }),
      );
      block.position.set(s.x, 0.3 + s.h / 2, -3);
      block.castShadow = true;
      block.receiveShadow = true;
      this.podium.add(block);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: rankTexture(s.rank, '#ffffff'), transparent: true }));
      num.position.set(s.x, 0.3 + s.h / 2, -3 + D / 2 + 0.02);
      this.podium.add(num);
      this.podiumColliders.push(
        this.world.createCollider(this.rapier.ColliderDesc.cuboid(W / 2, s.h / 2, D / 2).setTranslation(s.x, 0.3 + s.h / 2, -3)),
      );
    }
    this.podium.visible = false;
    this.scene.add(this.podium);
    for (const c of this.podiumColliders) c.setEnabled(false);
  }

  private setPodium(on: boolean) {
    this.podium.visible = on;
    for (const c of this.podiumColliders) c.setEnabled(on);
    if (!on) {
      for (const s of this.rankSprites) {
        this.scene.remove(s);
        s.material.map?.dispose();
        s.material.dispose();
      }
      this.rankSprites = [];
    }
  }

  private addRankSprite(rank: number, x: number, y: number, z: number, color: string, size = 1.7) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: rankTexture(rank, color), transparent: true, depthWrite: false }));
    sprite.scale.set(size, size, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 9;
    this.scene.add(sprite);
    this.rankSprites.push(sprite);
  }

  /** Finale: a 3D podium with the three best, everybody else applauds next to it, their places hover above them. */
  private finale(players: PublicPlayer[]) {
    this.resetPlatforms();
    this.setPodium(true);
    const ranked = [...players].sort((a, b) => b.score - a.score);
    const topSpots: { x: number; top: number }[] = [
      { x: 0, top: 3.5 },
      { x: -3.9, top: 2.5 },
      { x: 3.9, top: 1.8 },
    ];
    const medals = ['🥇', '🥈', '🥉'];
    const others = ranked.slice(3);
    ranked.forEach((p, rank) => {
      const robot = this.robots.get(p.id);
      if (!robot) return;
      robot.setTag(p.name || 'Игрок', p.score, null, false);
      robot.mood = 'idle';
      robot.dropping = false;
      if (rank < 3) {
        const spot = topSpots[rank];
        // they drop onto their steps from above, one after another
        this.later((2 - rank) * 700, () => {
          robot.teleport(spot.x, spot.top + 6 + (2 - rank), -3);
          robot.faceCamera();
          robot.celebrating = true;
          robot.spin = rank === 0;
          if (rank === 0) robot.setCrown(true);
        });
        this.later((2 - rank) * 700 + 1300, () => {
          this.addRankSprite(rank + 1, spot.x, spot.top + 3.6, -3, ['#ffe27a', '#e6edf5', '#e8a96a'][rank], 1.9);
          this.popups.showEmoji(spot.x, spot.top + 2.8, -3, medals[rank]);
          this.sparks.burst(spot.x, spot.top + 1.5, -3, 40, 5, ['#ffcc00', '#dfe6ee', '#e0a060'][rank], 6);
          sfx.land(0.9);
        });
        for (let k = 0; k < 14; k++) this.later(2200 + k * 1100 + rank * 300, () => robot.jump(rank === 0 ? 8 : 6));
      } else {
        // everybody else stands left and right of the podium and applauds
        const k = rank - 3;
        const side = k % 2 === 0 ? -1 : 1;
        const idx = Math.floor(k / 2);
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const x = side * (7.6 + col * 1.9);
        const z = -2 + row * 1.9;
        this.later(300 + k * 120, () => {
          robot.teleport(x, SKY_Y + (k % 4), z);
          robot.celebrating = false;
          robot.mood = 'clap';
          robot.setFacing(side * -0.45);
          this.later(900, () => this.addRankSprite(rank + 1, x, 3.75, z, '#ffcc00', 1.5));
        });
      }
    });
    // the camera swings around the podium, confetti and fireworks keep coming
    const shots: [number, number, number][] = [
      [0, 9, 21],
      [-5, 7.5, 18],
      [5, 8, 18.5],
      [0, 6.2, 15],
    ];
    for (let i = 0; i < 12; i++) {
      const [cx, cy, cz] = shots[i % shots.length];
      this.later(i * 2600, () => this.rig.focus(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(0, 2.6, -3)));
    }
    for (let i = 0; i < 10; i++) {
      this.later(1500 + i * 1800, () => {
        this.confetti.burst([[-4, -3], [0, -3], [4, -3]]);
        this.sparks.burst((Math.random() - 0.5) * 12, 6 + Math.random() * 3, -3, 40, 6, ['#ffcc00', '#ff4fd8', '#22d3ee', '#3dff8a'][i % 4], 6);
      });
    }
    this.later(300, () => sfx.victory());
  }

  // -------------------------------------------------------------- scene

  private buildEnvironment() {
    const scene = this.scene;
    scene.background = new THREE.Color(THEME.background);
    scene.fog = new THREE.Fog(THEME.background, 45, 90);

    scene.add(new THREE.HemisphereLight('#c8d4ff', '#2a1b4a', 1.1));
    const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
    sun.position.set(12, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 80;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    for (const [x, c] of [[-16, THEME.accent2], [16, '#22d3ee']] as const) {
      const spot = new THREE.SpotLight(c, 300, 60, 0.55, 0.6, 1.4);
      spot.position.set(x, 18, -10);
      spot.target.position.set(-x * 0.2, 0, 0);
      scene.add(spot, spot.target);
    }

    const floorTex = floorTexture(THEME.floor, THEME.floorAlt);
    for (const [x0, x1, z0, z1] of floorSegments()) {
      const w = x1 - x0;
      const d = z1 - z0;
      const tex = floorTex.clone();
      tex.repeat.set(w / 4, d / 4);
      tex.needsUpdate = true;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, 1, d),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05 }),
      );
      mesh.position.set((x0 + x1) / 2, -0.5, (z0 + z1) / 2);
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(w / 2, 0.5, d / 2).setTranslation((x0 + x1) / 2, -0.5, (z0 + z1) / 2).setFriction(0.9),
      );
    }

    const startPad = new THREE.Mesh(
      new THREE.RingGeometry(CENTER_RADIUS - 0.25, CENTER_RADIUS, 64),
      new THREE.MeshStandardMaterial({ color: THEME.accent, emissive: THEME.accent, emissiveIntensity: 0.6 }),
    );
    startPad.rotation.x = -Math.PI / 2;
    startPad.position.y = 0.015;
    scene.add(startPad);
    const startFill = new THREE.Mesh(
      new THREE.CircleGeometry(CENTER_RADIUS - 0.25, 64),
      new THREE.MeshStandardMaterial({ color: '#3d2c8f', roughness: 0.6, transparent: true, opacity: 0.85 }),
    );
    startFill.rotation.x = -Math.PI / 2;
    startFill.position.y = 0.01;
    startFill.receiveShadow = true;
    scene.add(startFill);

    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF * 2, 1, ARENA_HALF * 2),
      new THREE.MeshStandardMaterial({ color: '#07031a', roughness: 1 }),
    );
    pit.position.y = PIT_Y - 0.5;
    scene.add(pit);
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(ARENA_HALF, 0.5, ARENA_HALF).setTranslation(0, PIT_Y - 0.5, 0));

    const railMat = new THREE.MeshStandardMaterial({ color: '#5b3fd6', emissive: '#5b3fd6', emissiveIntensity: 0.35 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff7c2', emissive: '#ffd54f', emissiveIntensity: 2.2 });
    const bulbGeo = new THREE.SphereGeometry(0.18, 10, 8);
    for (const [x, z, w, d] of [
      [0, -ARENA_HALF - 0.5, ARENA_HALF * 2 + 2, 1],
      [0, ARENA_HALF + 0.5, ARENA_HALF * 2 + 2, 1],
      [-ARENA_HALF - 0.5, 0, 1, ARENA_HALF * 2],
      [ARENA_HALF + 0.5, 0, 1, ARENA_HALF * 2],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), railMat);
      rail.position.set(x, 0.4, z);
      scene.add(rail);
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(w / 2, 3, d / 2).setTranslation(x, 3, z));
      const n = Math.round(Math.max(w, d) / 2.5);
      for (let k = 0; k <= n; k++) {
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        const t = k / n - 0.5;
        bulb.position.set(x + (w > d ? t * w : 0), 0.95, z + (w > d ? 0 : t * d));
        scene.add(bulb);
      }
    }

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 4.9),
      new THREE.MeshBasicMaterial({ map: bannerTexture('ЗНАНИЕ — СИЛА: ARENA'), transparent: true }),
    );
    banner.position.set(0, 9, -ARENA_HALF - 1);
    scene.add(banner);

    const pillarMat = new THREE.MeshStandardMaterial({ color: '#2b1d6b', metalness: 0.5, roughness: 0.4 });
    for (const x of [-ARENA_HALF - 1, ARENA_HALF + 1]) {
      for (const z of [-ARENA_HALF - 1, ARENA_HALF + 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 10, 12), pillarMat);
        pillar.position.set(x, 5, z);
        scene.add(pillar);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), bulbMat);
        cap.position.set(x, 10.5, z);
        scene.add(cap);
      }
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.paused) {
      this.time += dt;
      this.runTimers();
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP && steps < 5) {
        for (const p of this.platforms) p.update(STEP, this.time);
        for (const r of this.robots.values()) r.update(STEP, this.time);
        this.world.step();
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 5) this.accumulator = 0;
      for (const r of this.robots.values()) {
        if (r.position.y < -2) r.fallen = true;
        // Robots that fell into a pit disappear from view (no models "under the ground"); they return from the sky.
        r.group.visible = r.position.y > -5 && !r.offscreen;
      }
      const remaining = this.questionEndsAt === null ? null : (this.questionEndsAt - (Date.now() + this.clockOffset)) / 1000;
      for (const [id, r] of this.robots) {
        const open = remaining !== null && !(this.answered.get(id) ?? false);
        r.nervous = open && remaining! < 4;
        r.shakingOff = open; // slimed robots fight the slime while the question is open
        
      }
      this.confetti.update(dt, this.time);
      this.dust.update(dt);
      this.sparks.update(dt);
      this.popups.update(dt);
      for (let i = this.cracks.length - 1; i >= 0; i--) {
        const c = this.cracks[i];
        c.life -= dt;
        c.sprite.material.opacity = Math.min(1, c.life / 1.2);
        if (c.life <= 0) {
          this.scene.remove(c.sprite);
          c.sprite.material.map?.dispose();
          c.sprite.material.dispose();
          this.cracks.splice(i, 1);
        }
      }
      this.rig.update(dt, this.time);
      if (this.shake > 0.002) {
        this.camera.position.x += (Math.random() - 0.5) * this.shake;
        this.camera.position.y += (Math.random() - 0.5) * this.shake;
        this.shake = Math.max(0, this.shake - dt * 1.4);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** Timers run on game time, so they freeze together with the scene when the host pauses. */
  private later(ms: number, fn: () => void) {
    this.timers.push({ at: this.time + ms / 1000, fn });
  }

  private runTimers() {
    const due = this.timers.filter((t) => t.at <= this.time);
    if (due.length === 0) return;
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.fn();
  }

  private clearTimers() {
    this.timers = [];
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clearTimers();
    this.resizeObserver.disconnect();
    for (const r of this.robots.values()) r.dispose(this.scene);
    this.robots.clear();
    this.world?.free();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
