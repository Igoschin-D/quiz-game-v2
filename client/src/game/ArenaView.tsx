import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '@quiz/shared';
import { ArenaScene } from './arena/ArenaScene';

export function ArenaView({ state, bus, closeUp }: { state: RoomState; bus?: EventTarget; closeUp?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ArenaScene | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    let scene: ArenaScene;
    try {
      scene = new ArenaScene(ref.current, state.roomId, Boolean(closeUp));
    } catch (e) {
      setError('Не удалось запустить 3D (WebGL недоступен в этом браузере).');
      console.error(e);
      return;
    }
    sceneRef.current = scene;
    scene.applyState(state);
    scene.init().catch((e) => {
      console.error(e);
      setError('Не удалось загрузить физический движок.');
    });
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roomId]);

  useEffect(() => {
    sceneRef.current?.applyState(state);
  }, [state]);

  useEffect(() => {
    if (!bus) return;
    const onReaction = (e: Event) => {
      const { playerId, emoji } = (e as CustomEvent<{ playerId: string; emoji: string }>).detail;
      sceneRef.current?.react(playerId, emoji);
    };
    bus.addEventListener('reaction', onReaction);
    return () => bus.removeEventListener('reaction', onReaction);
  }, [bus]);

  return (
    <div className="arena" ref={ref}>
      {error && <div className="arena-error">{error}</div>}
    </div>
  );
}
