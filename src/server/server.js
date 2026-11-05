/**
 * Express + Socket.IO Server implementation for Kachuful Online.
 * Authoritative server handling:
 * - create_room, join_room, reconnect, set_rules, start_game, place_bid, play_card
 * - Room expiration & disconnect recovery
 */

import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RoomManager } from './roomManager.js';
import { GAME_PHASES } from '../game/gameState.js';
import { calculateBotBid, chooseBotPlay } from '../game/bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServerApp(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' },
    pingInterval: 8000,
    pingTimeout: 5000
  });

  const roomManager = options.roomManager || new RoomManager();

  // Serve static files from public directory
  const publicDir = join(__dirname, '../../public');
  app.use(express.static(publicDir));
  app.use(express.json());

  // Health / API status
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', activeRooms: roomManager.rooms.size });
  });

  // Socket.IO real-time event router
  io.on('connection', (socket) => {
    let currentRoomCode = null;
    let currentPlayerId = null;

    // Helper to broadcast personalized game state to each player
    const broadcastGameState = (room) => {
      if (!room || !room.game) return;
      for (const p of room.players) {
        if (p.socketId) {
          const personalState = room.getPlayerGameState(p.id);
          io.to(p.socketId).emit('state_update', personalState);
        }
      }
    };

    // Helper to broadcast lobby state
    const broadcastLobbyState = (room) => {
      if (!room) return;
      io.to(room.code).emit('lobby_update', room.getLobbyState());
    };

    // Helper to process bot turn if the current turn belongs to a bot
    const handleBotTurnIfNeeded = (room) => {
      if (!room || !room.game) return;
      const game = room.game;
      if (game.phase !== GAME_PHASES.BIDDING && game.phase !== GAME_PHASES.PLAYING) {
        return;
      }

      const turnPlayerId = game.currentTurnPlayerId;
      if (!turnPlayerId) return;

      const playerObj = room.getPlayer(turnPlayerId);
      if (!playerObj || !playerObj.isBot) return;

      // Natural human-like speed:
      // - When guessing/bidding: 1200ms - 1800ms (evaluating hand & trump)
      // - When leading after a trick completed: 1800ms - 2400ms (allowing players to see trick winner banner)
      // - When playing a card during a trick: 1000ms - 1500ms (natural card play pace)
      let delay = Math.floor(1000 + Math.random() * 500);
      if (game.phase === GAME_PHASES.BIDDING) {
        delay = Math.floor(1200 + Math.random() * 600);
      } else if (game.phase === GAME_PHASES.PLAYING && game.currentTrick.length === 0 && game.lastCompletedTrick) {
        delay = Math.floor(2200 + Math.random() * 600);
      }

      if (room._botTimer) clearTimeout(room._botTimer);
      room._botTimer = setTimeout(() => {
        room._botTimer = null;
        try {
          if (!room.game || room.game.currentTurnPlayerId !== turnPlayerId) return;

          if (game.phase === GAME_PHASES.BIDDING) {
            const hand = game.hands.get(turnPlayerId) || [];
            const legalBids = game.getLegalBids(turnPlayerId);
            const chosenBid = calculateBotBid(hand, game.trumpSuit, legalBids);
            game.placeBid(turnPlayerId, chosenBid);
            broadcastGameState(room);
            handleBotTurnIfNeeded(room);
          } else if (game.phase === GAME_PHASES.PLAYING) {
            const hand = game.hands.get(turnPlayerId) || [];
            const bid = game.bids.get(turnPlayerId) ?? 0;
            const won = game.tricksWon.get(turnPlayerId) ?? 0;
            const chosenCard = chooseBotPlay(hand, game.currentTrick, game.trumpSuit, bid, won);
            game.playCard(turnPlayerId, chosenCard);
            broadcastGameState(room);
            handleBotTurnIfNeeded(room);
          }
        } catch (err) {
          console.error(`Bot move error for ${turnPlayerId}:`, err);
        }
      }, delay);
    };

    // 1. CREATE ROOM
    socket.on('create_room', ({ nickname }, callback) => {
      try {
        if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
          return callback?.({ success: false, error: 'Nickname is required.' });
        }
        const room = roomManager.createRoom(socket.id, nickname);
        currentRoomCode = room.code;
        currentPlayerId = socket.id;

        socket.join(room.code);
        const hostPlayer = room.getPlayer(socket.id);

        callback?.({
          success: true,
          roomCode: room.code,
          token: hostPlayer.token,
          playerId: hostPlayer.id,
          lobbyState: room.getLobbyState()
        });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 1b. PLAY WITH BOTS (Create room, add 3 bots, start game instantly)
    socket.on('play_with_bots', ({ nickname }, callback) => {
      try {
        const cleanNick = (nickname && typeof nickname === 'string' && nickname.trim().length > 0)
          ? nickname.trim()
          : 'Player';
        const room = roomManager.createRoom(socket.id, cleanNick);
        currentRoomCode = room.code;
        currentPlayerId = socket.id;
        socket.join(room.code);

        // Add 3 bots
        room.addBot(socket.id);
        room.addBot(socket.id);
        room.addBot(socket.id);

        // Start game immediately
        room.startGame(socket.id);

        const hostPlayer = room.getPlayer(socket.id);
        const gameState = room.getPlayerGameState(socket.id);

        callback?.({
          success: true,
          roomCode: room.code,
          token: hostPlayer.token,
          playerId: hostPlayer.id,
          lobbyState: room.getLobbyState(),
          gameState
        });

        broadcastGameState(room);
        handleBotTurnIfNeeded(room);
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 2. JOIN ROOM
    socket.on('join_room', ({ roomCode, nickname, token }, callback) => {
      try {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
          return callback?.({ success: false, error: `Room "${roomCode}" not found.` });
        }

        // Check if player has an existing session token to reconnect
        if (token) {
          const existingPlayer = room.getPlayerByToken(token);
          if (existingPlayer) {
            const player = room.reconnectPlayer(token, socket.id);
            currentRoomCode = room.code;
            currentPlayerId = player.id;
            socket.join(room.code);

            const isGameStarted = !!(room.game && room.game.phase !== GAME_PHASES.NOT_STARTED);
            const gameState = isGameStarted ? room.getPlayerGameState(player.id) : null;

            callback?.({
              success: true,
              roomCode: room.code,
              token: player.token,
              playerId: player.id,
              isGameStarted,
              lobbyState: room.getLobbyState(),
              gameState
            });

            if (isGameStarted) {
              broadcastGameState(room);
              handleBotTurnIfNeeded(room);
            } else {
              broadcastLobbyState(room);
            }
            return;
          }
        }

        // Friendly nickname disambiguation if name taken
        let cleanNick = (nickname || 'Player').trim().slice(0, 15);
        if (room.players.some(p => p.name.toLowerCase() === cleanNick.toLowerCase())) {
          let counter = 2;
          while (room.players.some(p => p.name.toLowerCase() === `${cleanNick} ${counter}`.toLowerCase())) {
            counter++;
          }
          cleanNick = `${cleanNick} ${counter}`.slice(0, 15);
        }

        const player = room.addPlayer(socket.id, cleanNick);
        currentRoomCode = room.code;
        currentPlayerId = player.id;

        socket.join(room.code);

        callback?.({
          success: true,
          roomCode: room.code,
          token: player.token,
          playerId: player.id,
          lobbyState: room.getLobbyState()
        });

        // Notify other room members
        socket.to(room.code).emit('lobby_update', room.getLobbyState());
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 3. RECONNECT (FR-19)
    socket.on('reconnect_session', ({ roomCode, token }, callback) => {
      try {
        const room = roomManager.getRoom(roomCode);
        if (!room) {
          return callback?.({ success: false, error: 'Room not found or expired.' });
        }

        const player = room.reconnectPlayer(token, socket.id);
        currentRoomCode = room.code;
        currentPlayerId = player.id;
        socket.join(room.code);

        const isGameStarted = !!(room.game && room.game.phase !== GAME_PHASES.NOT_STARTED);
        const gameState = isGameStarted ? room.getPlayerGameState(player.id) : null;

        callback?.({
          success: true,
          playerId: player.id,
          nickname: player.name,
          isGameStarted,
          lobbyState: room.getLobbyState(),
          gameState
        });

        if (isGameStarted) {
          broadcastGameState(room);
          handleBotTurnIfNeeded(room);
        } else {
          broadcastLobbyState(room);
        }
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 3b. LEAVE ROOM
    socket.on('leave_room', (data, callback) => {
      try {
        if (currentRoomCode) {
          const room = roomManager.getRoom(currentRoomCode);
          if (room) {
            room.disconnectPlayer(socket.id);
            socket.leave(room.code);
            if (room.game && room.game.phase !== GAME_PHASES.NOT_STARTED) {
              broadcastGameState(room);
            } else {
              broadcastLobbyState(room);
            }
          }
          currentRoomCode = null;
          currentPlayerId = null;
        }
        callback?.({ success: true });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 4. UPDATE RULES (Host only)
    socket.on('update_rules', ({ rules }, callback) => {
      try {
        const room = roomManager.getRoom(currentRoomCode);
        if (!room) return callback?.({ success: false, error: 'Room not found.' });

        const updated = room.updateRules(currentPlayerId, rules);
        broadcastLobbyState(room);
        callback?.({ success: true, rules: updated });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 4b. ADD BOT (Host only)
    socket.on('add_bot', (data, callback) => {
      try {
        const room = roomManager.getRoom(currentRoomCode);
        if (!room) return callback?.({ success: false, error: 'Room not found.' });
        const count = Math.min(Math.max(parseInt(data?.count, 10) || 1, 1), 7);
        for (let i = 0; i < count; i++) {
          if (room.players.length >= room.rules.maxPlayers) break;
          room.addBot(currentPlayerId);
        }
        broadcastLobbyState(room);
        callback?.({ success: true, lobbyState: room.getLobbyState() });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 4c. REMOVE BOT (Host only)
    socket.on('remove_bot', ({ botId }, callback) => {
      try {
        const room = roomManager.getRoom(currentRoomCode);
        if (!room) return callback?.({ success: false, error: 'Room not found.' });
        room.removeBot(currentPlayerId, botId);
        broadcastLobbyState(room);
        callback?.({ success: true, lobbyState: room.getLobbyState() });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 5. START GAME (Host only)
    socket.on('start_game', (data, callback) => {
      try {
        const room = roomManager.getRoom(currentRoomCode);
        if (!room) return callback?.({ success: false, error: 'Room not found.' });

        room.startGame(currentPlayerId);
        callback?.({ success: true });

        // Push initial personalized game state to each player
        broadcastGameState(room);
        handleBotTurnIfNeeded(room);
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 6. PLACE BID
    socket.on('place_bid', ({ bid }, callback) => {
      try {
        const room = roomManager.getRoom(currentRoomCode);
        if (!room || !room.game) return callback?.({ success: false, error: 'Game not active.' });

        room.game.placeBid(currentPlayerId, bid);
        callback?.({ success: true });
        broadcastGameState(room);
        handleBotTurnIfNeeded(room);
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 7. PLAY CARD
    socket.on('play_card', ({ card }, callback) => {
      try {
        const room = roomManager.getRoom(currentRoomCode);
        if (!room || !room.game) return callback?.({ success: false, error: 'Game not active.' });

        const playResult = room.game.playCard(currentPlayerId, card);
        callback?.({ success: true, result: playResult });
        broadcastGameState(room);
        handleBotTurnIfNeeded(room);
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // 8. ADVANCE TO NEXT ROUND (after ROUND_ENDED review)
    socket.on('next_round', (data, callback) => {
      try {
        const room = roomManager.getRoom(currentRoomCode);
        if (!room || !room.game) return callback?.({ success: false, error: 'Game not active.' });
        if (room.hostId !== currentPlayerId) {
          return callback?.({ success: false, error: 'Only the host can start the next round.' });
        }

        if (room.game.phase === GAME_PHASES.ROUND_ENDED) {
          room.game.startNextRound();
          callback?.({ success: true });
          broadcastGameState(room);
          handleBotTurnIfNeeded(room);
        } else {
          callback?.({ success: false, error: 'Current round is not complete yet.' });
        }
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // DISCONNECT
    socket.on('disconnect', () => {
      if (currentRoomCode) {
        const room = roomManager.getRoom(currentRoomCode);
        if (room) {
          room.disconnectPlayer(socket.id);
          if (room.game && room.game.phase !== GAME_PHASES.NOT_STARTED) {
            broadcastGameState(room);
          } else {
            broadcastLobbyState(room);
          }
        }
      }
    });
  });

  return { app, server, io, roomManager };
}
