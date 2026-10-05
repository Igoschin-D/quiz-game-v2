import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

let loading: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  loading ??= RAPIER.init().then(() => RAPIER);
  return loading;
}
