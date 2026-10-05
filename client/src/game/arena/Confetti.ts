import * as THREE from 'three';

const COUNT = 260;
const COLORS = ['#ffcc00', '#ff4fd8', '#3dff8a', '#22d3ee', '#ffffff', '#ff7043'];

/** Instanced confetti burst, simulated without the physics engine. */
export class Confetti {
  private readonly mesh: THREE.InstancedMesh;
  private readonly pos = new Float32Array(COUNT * 3);
  private readonly vel = new Float32Array(COUNT * 3);
  private readonly spin = new Float32Array(COUNT);
  private life = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.18, 0.1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      COUNT,
    );
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) this.mesh.setColorAt(i, c.set(COLORS[i % COLORS.length]));
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  burst(points: [number, number][]) {
    if (points.length === 0) return;
    for (let i = 0; i < COUNT; i++) {
      const [x, z] = points[i % points.length];
      this.pos.set([x + (Math.random() - 0.5) * 4, 0.5, z + (Math.random() - 0.5) * 4], i * 3);
      this.vel.set([(Math.random() - 0.5) * 6, 8 + Math.random() * 9, (Math.random() - 0.5) * 6], i * 3);
      this.spin[i] = (Math.random() - 0.5) * 20;
    }
    this.life = 3.2;
    this.mesh.visible = true;
  }

  update(dt: number, time: number) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.mesh.visible = false;
      return;
    }
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      this.vel[k + 1] -= 14 * dt;
      this.vel[k] *= 0.985;
      this.vel[k + 2] *= 0.985;
      if (this.vel[k + 1] < -2.5) this.vel[k + 1] = -2.5;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.p.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      this.e.set(time * this.spin[i], time * this.spin[i] * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
