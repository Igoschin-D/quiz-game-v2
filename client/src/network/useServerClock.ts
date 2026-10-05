import { useEffect, useState } from 'react';
import type { RoomState } from '@quiz/shared';

let offset = 0;

/** Call on every state message: keeps a running estimate of server time minus local time. */
export function trackServerClock(st: RoomState) {
  const sample = st.serverNow - Date.now();
  offset = offset === 0 ? sample : offset * 0.7 + sample * 0.3;
}

export function serverNow() {
  return Date.now() + offset;
}

/** Seconds left until the current phase ends (null when the phase is open-ended). */
export function useSecondsLeft(st: RoomState | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!st?.phaseEndsAt) {
      setLeft(null);
      return;
    }
    if (st.paused) {
      setLeft((st.pausedRemainingMs ?? 0) / 1000);
      return;
    }
    const tick = () => setLeft(Math.max(0, (st.phaseEndsAt! - serverNow()) / 1000));
    tick();
    const id = window.setInterval(tick, 100);
    return () => clearInterval(id);
  }, [st?.phaseEndsAt, st?.paused, st?.pausedRemainingMs]);
  return left;
}
