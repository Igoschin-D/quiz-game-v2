import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@quiz/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): GameSocket {
  return io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 2000 });
}

/** Promise wrapper around socket.io acknowledgements. */
export function request<T extends object = object>(send: (cb: (res: Ack<T>) => void) => void, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'Нет ответа от сервера' }), timeoutMs);
    send((res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}
