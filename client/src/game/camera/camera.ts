import * as THREE from 'three';

const BASE = new THREE.Vector3(0, 23, 25);
const LOOK = new THREE.Vector3(0, -0.5, 0.5);
// close-up used by the /gallery page to inspect the robot models
const CLOSE_BASE = new THREE.Vector3(0, 6.5, 14.5);
const CLOSE_LOOK = new THREE.Vector3(0, 1.1, 0);

export function setupCamera(closeUp = false) {
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 200);
  camera.position.copy(closeUp ? CLOSE_BASE : BASE);
  camera.lookAt(closeUp ? CLOSE_LOOK : LOOK);
  return camera;
}

/** Gentle TV-studio sway so the scene never looks frozen. */
export function updateCamera(camera: THREE.PerspectiveCamera, time: number, closeUp = false) {
  if (closeUp) {
    camera.position.set(CLOSE_BASE.x + Math.sin(time * 0.3) * 0.4, CLOSE_BASE.y, CLOSE_BASE.z);
    camera.lookAt(CLOSE_LOOK);
    return;
  }
  camera.position.set(BASE.x + Math.sin(time * 0.12) * 1.6, BASE.y + Math.sin(time * 0.17) * 0.4, BASE.z);
  camera.lookAt(LOOK);
}

/** Smooth camera: follows the default TV-studio shot or glides to a focus point (power-up show, podium). */
export class CameraRig {
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tPos = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();
  private focused = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly closeUp: boolean,
  ) {
    this.pos.copy(closeUp ? CLOSE_BASE : BASE);
    this.look.copy(closeUp ? CLOSE_LOOK : LOOK);
  }

  /** Glide to a new shot. */
  focus(pos: THREE.Vector3, look: THREE.Vector3) {
    this.tPos.copy(pos);
    this.tLook.copy(look);
    this.focused = true;
  }

  /** Back to the default shot. */
  reset() {
    this.focused = false;
  }

  update(dt: number, time: number) {
    if (this.focused) {
      const k = 1 - Math.exp(-dt * 2.4);
      this.pos.lerp(this.tPos, k);
      this.look.lerp(this.tLook, k);
    } else {
      const base = this.closeUp ? CLOSE_BASE : BASE;
      const look = this.closeUp ? CLOSE_LOOK : LOOK;
      const sway = this.closeUp ? 0.4 : 1.6;
      const target = new THREE.Vector3(base.x + Math.sin(time * (this.closeUp ? 0.3 : 0.12)) * sway, base.y + (this.closeUp ? 0 : Math.sin(time * 0.17) * 0.4), base.z);
      const k = 1 - Math.exp(-dt * 1.8);
      this.pos.lerp(target, k);
      this.look.lerp(look, k);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
