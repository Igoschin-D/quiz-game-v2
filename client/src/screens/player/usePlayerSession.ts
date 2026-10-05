import { useEffect, useMemo, useState } from 'react';
import type { Notice, PlayerPrivate, RoomState } from '@quiz/shared';
import { createSocket, request } from '../../network/socket';
import { sessions } from '../../network/session';
import { trackServerClock } from '../../network/useServerClock';

export function usePlayerSession(roomId: string) {
  const socket = useMemo(createSocket, []);
  const [state, setState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [closed, setClosed] = useState(false);
  const [priv, setPriv] = useState<PlayerPrivate | null>(null);
  const [notices, setNotices] = useState<(Notice & { id: number })[]>([]);

  useEffect(() => {
    if (socket.disconnected) socket.connect();
    const join = async () => {
      setConnected(true);
      const saved = sessions.player(roomId);
      const res = await request<{ playerId: string; token: string }>((cb) =>
        socket.emit('player:join', { roomId, token: saved?.token }, cb),
      );
      if (res.ok) {
        sessions.setPlayer(roomId, { playerId: res.playerId, token: res.token });
        setPlayerId(res.playerId);
        setError(null);
      } else {
        setError(res.error);
      }
    };
    socket.on('connect', join);
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (st) => {
      trackServerClock(st);
      setState(st);
    });
    // safety net: a phone that missed an update (sleeping tab, flaky Wi-Fi) catches up within a few seconds
    const sync = () => {
      if (socket.connected && document.visibilityState === 'visible') socket.emit('player:sync');
    };
    const heartbeat = window.setInterval(sync, 4000);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    socket.on('me', setPriv);
    socket.on('notice', (n) => {
      const id = Date.now() + Math.random();
      setNotices((list) => [...list, { ...n, id }]);
      window.setTimeout(() => setNotices((list) => list.filter((x) => x.id !== id)), 3800);
    });
    socket.on('roomClosed', () => {
      sessions.setPlayer(roomId, null);
      setClosed(true);
    });
    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket, roomId]);

  const me = state?.players.find((p) => p.id === playerId) ?? null;
  return { socket, state, me, priv, notices, playerId, error, connected, closed };
}
