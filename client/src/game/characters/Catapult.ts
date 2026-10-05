import * as THREE from 'three';

/** Wooden siege catapult that shoots a robot into the host screen. The arm points along local z (throwing side is +z). */
export class Catapult {
  readonly group = new THREE.Group();
  private readonly inner = new THREE.Group(); // scaled for the pop-up animation
  private readonly arm = new THREE.Group();
  private readonly cup = new THREE.Object3D();

  static readonly PIVOT_Y = 1.7;
  /** Distance of the cup from the pivot along the arm (towards -z). */
  static readonly CUP_DIST = 1.9;

  constructor() {
    const wood = new THREE.MeshStandardMaterial({ color: '#9a6232', roughness: 0.85 });
    const darkWood = new THREE.MeshStandardMaterial({ color: '#6b3f1d', roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: '#3a3d48', metalness: 0.7, roughness: 0.4 });
    const stone = new THREE.MeshStandardMaterial({ color: '#7a7f8c', roughness: 0.95 });
    const rope = new THREE.MeshStandardMaterial({ color: '#d8c48a', roughness: 1 });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // base frame and wheels
    add(this.inner, new THREE.BoxGeometry(2.0, 0.22, 3.6), wood, 0, 0.5, -0.2);
    for (const side of [-1, 1]) {
      for (const z of [-1.4, 0.9]) {
        const wheel = add(this.inner, new THREE.CylinderGeometry(0.42, 0.42, 0.18, 18), darkWood, side * 1.1, 0.42, z);
        wheel.rotation.z = Math.PI / 2;
        const hub = add(this.inner, new THREE.CylinderGeometry(0.12, 0.12, 0.24, 10), iron, side * 1.1, 0.42, z);
        hub.rotation.z = Math.PI / 2;
      }
      // A-frame supports holding the pivot
      const post = add(this.inner, new THREE.BoxGeometry(0.2, 1.5, 0.2), wood, side * 0.8, 1.25, 0);
      post.rotation.z = -side * 0.12;
      const brace1 = add(this.inner, new THREE.BoxGeometry(0.14, 1.5, 0.14), darkWood, side * 0.8, 1.15, 0.7);
      brace1.rotation.x = 0.62;
      const brace2 = add(this.inner, new THREE.BoxGeometry(0.14, 1.5, 0.14), darkWood, side * 0.8, 1.15, -0.7);
      brace2.rotation.x = -0.62;
    }
    // axle
    const axle = add(this.inner, new THREE.CylinderGeometry(0.1, 0.1, 2.0, 10), iron, 0, Catapult.PIVOT_Y, 0);
    axle.rotation.z = Math.PI / 2;

    // throwing arm (rotates around the x axis at the pivot)
    this.arm.position.y = Catapult.PIVOT_Y;
    add(this.arm, new THREE.BoxGeometry(0.24, 0.24, 3.9), wood, 0, 0, -0.45);
    // counterweight at the +z end
    add(this.arm, new THREE.BoxGeometry(0.95, 0.8, 0.8), stone, 0, -0.35, 1.15);
    add(this.arm, new THREE.BoxGeometry(1.0, 0.1, 0.85), iron, 0, 0.1, 1.15);
    // cup at the -z end: a bowl opening upwards
    const bowl = add(this.arm, new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), iron, 0, 0.02, -Catapult.CUP_DIST);
    bowl.rotation.x = Math.PI;
    add(this.arm, new THREE.TorusGeometry(0.62, 0.05, 8, 20), darkWood, 0, 0.02, -Catapult.CUP_DIST).rotation.x = Math.PI / 2;
    // rope from the arm tip to the base (decor)
    add(this.arm, new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), rope, 0, -0.7, -Catapult.CUP_DIST - 0.3);
    this.cup.position.set(0, 0.1, -Catapult.CUP_DIST);
    this.arm.add(this.cup);

    this.inner.add(this.arm);
    this.group.add(this.inner);
  }

  /** Arm angle in radians: negative = cup low (loaded), positive = swung up and over. */
  setArm(angle: number) {
    this.arm.rotation.x = angle;
  }

  /** Pop-up scale 0..1 (overshoots a little for a springy build animation). */
  setBuild(k: number) {
    const s = Math.max(0.001, k <= 0 ? 0.001 : 1 + Math.sin(k * Math.PI) * 0.12 * (1 - k) - (1 - k) * (1 - k) * 0.9);
    this.inner.scale.setScalar(Math.min(1.15, Math.max(0.05, s)));
  }

  cupWorld(out: THREE.Vector3) {
    this.group.updateMatrixWorld(true);
    return this.cup.getWorldPosition(out);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
