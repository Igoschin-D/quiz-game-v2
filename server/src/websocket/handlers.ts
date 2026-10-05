import type { Server, Socket } from 'socket.io';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@quiz/shared';
import { GameError, type Room } from '../game/Room';
import type { RoomManager } from '../room/RoomManager';

interface SocketData {
  role?: 'host' | 'player';
  roomId?: string;
  playerId?: string;
}

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof GameError) return { ok: false, error: err.message };
  console.error(err);
  return { ok: false, error: 'Внутренняя ошибка сервера' };
}

export function broadcast(io: GameServer, room: Room) {
  io.to(room.id).emit('state', room.publicState());
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('me', room.privateState(p));
  }
  for (const { playerId, notice } of room.drainNotices()) {
    const target = room.players.get(playerId);
    if (target?.socketId) io.to(target.socketId).emit('notice', notice);
  }
}

export function registerHandlers(io: GameServer, rooms: RoomManager) {
  io.on('connection', (socket: GameSocket) => {
    const run = <T extends object>(cb: ((res: Ack<T>) => void) | undefined, fn: () => T | void) => {
      try {
        const extra = fn() ?? ({} as T);
        cb?.({ ok: true, ...(extra as T) });
      } catch (err) {
        cb?.(fail(err));
      }
    };

    const hostRoom = (): Room => {
      const room = socket.data.role === 'host' ? rooms.get(socket.data.roomId) : undefined;
      if (!room) throw new GameError('Вы не ведущий этой комнаты');
      return room;
    };

    const playerCtx = () => {
      const room = socket.data.role === 'player' ? rooms.get(socket.data.roomId) : undefined;
      const player = room && socket.data.playerId ? room.players.get(socket.data.playerId) : undefined;
      if (!room || !player) throw new GameError('Сначала подключитесь к комнате');
      return { room, player };
    };

    const bindHost = (room: Room) => {
      socket.data = { role: 'host', roomId: room.id };
      room.hostSocketId = socket.id;
      socket.join(room.id);
    };

    socket.on('host:create', (cb) =>
      run(cb, () => {
        const room = rooms.create();
        bindHost(room);
        broadcast(io, room);
        return { roomId: room.id, hostToken: room.hostToken };
      }),
    );

    socket.on('host:rejoin', ({ roomId, hostToken }, cb) =>
      run(cb, () => {
        const room = rooms.get(roomId);
        if (!room || room.hostToken !== hostToken) throw new GameError('Комната не найдена');
        bindHost(room);
        broadcast(io, room);
      }),
    );

    socket.on('host:start', (cb) => run(cb, () => hostRoom().start()));
    socket.on('host:next', (cb) => run(cb, () => hostRoom().next()));
    socket.on('host:skip', (cb) => run(cb, () => hostRoom().skip()));
    socket.on('host:restart', (cb) => run(cb, () => hostRoom().restart()));
    socket.on('host:pause', ({ paused }, cb) => run(cb, () => hostRoom().setPaused(Boolean(paused))));
    socket.on('host:addBots', ({ count }, cb) =>
      run(cb, () => {
        const room = hostRoom();
        room.addBots(Number(count) || 0);
        broadcast(io, room);
      }),
    );
    socket.on('host:close', (cb) =>
      run(cb, () => {
        const room = hostRoom();
        io.to(room.id).emit('roomClosed');
        rooms.remove(room.id);
      }),
    );

    socket.on('player:join', ({ roomId, token }, cb) =>
      run(cb, () => {
        const room = rooms.get(roomId);
        if (!room) throw new GameError('Комната не найдена. Проверьте код.');
        let player = token ? room.playerByToken(token) : undefined;
        if (player) room.attachSocket(player, socket.id);
        else player = room.addPlayer(socket.id);
        socket.data = { role: 'player', roomId: room.id, playerId: player.id };
        socket.join(room.id);
        broadcast(io, room);
        return { playerId: player.id, token: player.token };
      }),
    );

    socket.on('player:profile', ({ name, avatar, comment }, cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        room.setProfile(player, name, avatar, comment);
        broadcast(io, room);
      }),
    );

    socket.on('player:photo', ({ dataUrl }, cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        room.setPhoto(player, String(dataUrl));
        broadcast(io, room);
      }),
    );

    socket.on('player:ready', ({ ready }, cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        room.setReady(player, Boolean(ready));
        broadcast(io, room);
      }),
    );

    socket.on('player:answer', ({ questionIndex, answer }, cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        room.answer(player, Number(questionIndex), Number(answer));
        broadcast(io, room);
      }),
    );

    socket.on('player:usePowerup', ({ type, targetId }, cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        room.usePowerup(player, type, targetId ? String(targetId) : undefined);
        broadcast(io, room);
      }),
    );

    socket.on('player:react', ({ emoji }, cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        room.react(player, String(emoji));
        io.to(room.id).emit('reaction', { playerId: player.id, emoji: String(emoji) });
      }),
    );

    // phones ask for a fresh copy of the state now and then (lost packets, sleeping browser tab)
    socket.on('player:sync', (cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        socket.emit('state', room.publicState());
        socket.emit('me', room.privateState(player));
      }),
    );

    socket.on('player:bombed', (cb) =>
      run(cb, () => {
        const { room, player } = playerCtx();
        room.bomb(player);
        broadcast(io, room);
      }),
    );

    socket.on('disconnect', () => {
      const room = rooms.get(socket.data.roomId);
      if (!room) return;
      room.handleDisconnect(socket.id);
      broadcast(io, room);
    });
  });
}
