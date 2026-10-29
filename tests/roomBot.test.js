import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/server/roomManager.js';
import { GAME_PHASES } from '../src/game/gameState.js';

describe('Bots in Room', () => {
  it('allows host to add and remove bots', () => {
    const rm = new RoomManager();
    const room = rm.createRoom('socket_host', 'HostPlayer');

    const bot1 = room.addBot('socket_host');
    assert.ok(bot1.id.startsWith('bot_'));
    assert.equal(bot1.isBot, true);
    assert.equal(room.players.length, 2);

    const bot2 = room.addBot('socket_host');
    assert.equal(room.players.length, 3);

    room.removeBot('socket_host', bot1.id);
    assert.equal(room.players.length, 2);
    assert.equal(room.getPlayer(bot1.id), undefined);
  });

  it('allows starting a game with bots once minimum player count is met', () => {
    const rm = new RoomManager();
    const room = rm.createRoom('socket_host', 'HostPlayer');
    room.addBot('socket_host');
    room.addBot('socket_host'); // 3 players total

    const game = room.startGame('socket_host');
    assert.equal(game.phase, GAME_PHASES.BIDDING);
    assert.equal(game.players.length, 3);
  });
});

