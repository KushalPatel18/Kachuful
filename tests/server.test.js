import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import { createServerApp } from '../src/server/server.js';
import { RoomManager } from '../src/server/roomManager.js';

test('RoomManager - creates room with unique 5-char code, adds players, tracks session tokens', () => {
  const rm = new RoomManager();
  const room = rm.createRoom('socket_host_1', 'HostPlayer');

  assert.equal(typeof room.code, 'string');
  assert.equal(room.code.length, 5);
  assert.equal(room.players.length, 1);
  assert.equal(room.players[0].name, 'HostPlayer');
  assert.ok(room.players[0].token);

  // Add second player
  const p2 = room.addPlayer('socket_p2', 'Bob');
  assert.equal(room.players.length, 2);
  assert.equal(p2.name, 'Bob');
  assert.ok(p2.token);

  // Duplicate name rejection
  assert.throws(() => {
    room.addPlayer('socket_p3', 'bob');
  }, /already taken/);

  // Reconnect with token
  const reconnected = room.reconnectPlayer(p2.token, 'new_socket_for_bob');
  assert.equal(reconnected.socketId, 'new_socket_for_bob');
  assert.equal(reconnected.connected, true);
});

test('Server & Socket.IO - create_room, join_room, update_rules, and lobby_update', async () => {
  const roomManager = new RoomManager();
  const { server } = createServerApp({ roomManager });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  const client1 = Client(url);
  const client2 = Client(url);

  try {
    // 1. Create Room from client 1
    const createRes = await new Promise((resolve) => {
      client1.emit('create_room', { nickname: 'Alice' }, resolve);
    });

    assert.equal(createRes.success, true);
    assert.ok(createRes.roomCode);
    assert.ok(createRes.token);
    assert.equal(createRes.lobbyState.players.length, 1);
    assert.equal(createRes.lobbyState.players[0].name, 'Alice');

    const roomCode = createRes.roomCode;

    // Setup listener on client1 for lobby_update when client2 joins
    const lobbyUpdatePromise = new Promise((resolve) => {
      client1.on('lobby_update', (state) => {
        if (state.players.length === 2) resolve(state);
      });
    });

    // 2. Join Room from client 2
    const joinRes = await new Promise((resolve) => {
      client2.emit('join_room', { roomCode, nickname: 'Bob' }, resolve);
    });

    assert.equal(joinRes.success, true);
    assert.equal(joinRes.roomCode, roomCode);
    assert.ok(joinRes.token);

    // Client1 received the lobby update with 2 players
    const updatedLobby = await lobbyUpdatePromise;
    assert.equal(updatedLobby.players.length, 2);
    assert.deepEqual(updatedLobby.players.map(p => p.name), ['Alice', 'Bob']);

    // 3. Update rules by host
    const rulesUpdateRes = await new Promise((resolve) => {
      client1.emit('update_rules', { rules: { maxCardsCap: 5 } }, resolve);
    });
    assert.equal(rulesUpdateRes.success, true);
    assert.equal(rulesUpdateRes.rules.maxCardsCap, 5);

    // Non-host (client2) trying to update rules is rejected
    const nonHostRulesRes = await new Promise((resolve) => {
      client2.emit('update_rules', { rules: { maxCardsCap: 3 } }, resolve);
    });
    assert.equal(nonHostRulesRes.success, false);
    assert.match(nonHostRulesRes.error, /Only the host/);

  } finally {
    client1.disconnect();
    client2.disconnect();
    await new Promise((resolve) => server.close(resolve));
  }
});
