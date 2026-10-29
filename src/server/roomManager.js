/**
 * Room management for Kachuful Online.
 * Handles room creation, player joining, host privileges, rule changes,
 * seat management, and session tokens for reconnects (FR-1 to FR-6, FR-19).
 */

import { randomBytes } from 'node:crypto';
import { GameState, GAME_PHASES } from '../game/gameState.js';
import { getGameConfig } from '../game/config.js';

export class Room {
  /**
   * @param {string} code - 4 to 6 uppercase alphanumeric code
   * @param {string} hostPlayerId - socket/player ID
   * @param {string} hostNickname - player's chosen nickname
   */
  constructor(code, hostPlayerId, hostNickname) {
    this.code = code;
    this.hostId = hostPlayerId;
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.rules = getGameConfig({}, 4);

    // Array of players: { id: string, name: string, token: string, connected: boolean, socketId: string }
    this.players = [];

    // Add host as first player
    const hostToken = randomBytes(16).toString('hex');
    this.players.push({
      id: hostPlayerId,
      name: hostNickname.trim().slice(0, 15),
      token: hostToken,
      connected: true,
      socketId: hostPlayerId
    });

    this.game = null; // Instance of GameState when started
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId);
  }

  getPlayerByToken(token) {
    return this.players.find(p => p.token === token);
  }

  /**
   * Add a new player to the lobby.
   */
  addPlayer(socketId, nickname) {
    this.touch();
    const cleanNick = (nickname || 'Player').trim().slice(0, 15);

    if (this.game && this.game.phase !== GAME_PHASES.NOT_STARTED && this.game.phase !== GAME_PHASES.GAME_OVER) {
      throw new Error('Game already in progress. Only existing players can reconnect.');
    }

    if (this.players.length >= this.rules.maxPlayers) {
      throw new Error(`Room is full (maximum ${this.rules.maxPlayers} players).`);
    }

    // Check unique nickname within room
    const nameExists = this.players.some(p => p.name.toLowerCase() === cleanNick.toLowerCase());
    if (nameExists) {
      throw new Error(`Nickname "${cleanNick}" is already taken in this room.`);
    }

    const token = randomBytes(16).toString('hex');
    const player = {
      id: socketId,
      name: cleanNick,
      token,
      connected: true,
      socketId
    };
    this.players.push(player);

    return player;
  }

  /**
   * Reconnect an existing player using their stored session token (FR-19).
   */
  reconnectPlayer(token, newSocketId) {
    this.touch();
    const player = this.getPlayerByToken(token);
    if (!player) {
      throw new Error('Invalid session token.');
    }

    player.connected = true;
    player.socketId = newSocketId;
    return player;
  }

  /**
   * Mark a player as disconnected.
   */
  disconnectPlayer(socketId) {
    this.touch();
    const player = this.players.find(p => p.socketId === socketId);
    if (player) {
      player.connected = false;
      return player;
    }
    return null;
  }

  /**
   * Remove a player (only in lobby or by host).
   */
  removePlayer(playerId) {
    this.touch();
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return false;

    this.players.splice(idx, 1);

    // If host left, elect next connected player as host
    if (this.hostId === playerId && this.players.length > 0) {
      const nextConnected = this.players.find(p => p.connected) || this.players[0];
      this.hostId = nextConnected.id;
    }

    return true;
  }

  /**
   * Update room rule settings (Host only, during lobby).
   */
  updateRules(hostId, newRules) {
    this.touch();
    if (this.hostId !== hostId) {
      throw new Error('Only the host can modify game rules.');
    }
    if (this.game && this.game.phase !== GAME_PHASES.NOT_STARTED) {
      throw new Error('Cannot change rules after game has started.');
    }
    this.rules = getGameConfig({ ...this.rules, ...newRules }, this.players.length);
    return this.rules;
  }

  /**
   * Starts the game (Host only).
   */
  startGame(hostId) {
    this.touch();
    if (this.hostId !== hostId) {
      throw new Error('Only the host can start the game.');
    }
    if (this.players.length < this.rules.minPlayers) {
      throw new Error(`Need at least ${this.rules.minPlayers} players to start (currently ${this.players.length}).`);
    }

    // Initialize GameState with current players
    const gamePlayers = this.players.map(p => ({ id: p.id, name: p.name }));
    this.game = new GameState({
      players: gamePlayers,
      rules: this.rules
    });
    this.game.startGame();
    return this.game;
  }

  /**
   * Safe lobby & room view.
   */
  getLobbyState() {
    return {
      roomCode: this.code,
      hostId: this.hostId,
      rules: this.rules,
      isGameStarted: !!(this.game && this.game.phase !== GAME_PHASES.NOT_STARTED),
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        isHost: p.id === this.hostId
      }))
    };
  }

  /**
   * Get player-specific client state once game is running.
   */
  getPlayerGameState(playerId) {
    if (!this.game) return null;
    const clientState = this.game.getClientState(playerId);
    // Enrich with connection status from room
    clientState.players = clientState.players.map(p => {
      const roomP = this.getPlayer(p.id);
      return {
        ...p,
        connected: roomP ? roomP.connected : false
      };
    });
    clientState.roomCode = this.code;
    clientState.hostId = this.hostId;
    return clientState;
  }
}

/**
 * RoomManager: Manages all active rooms in memory.
 * Expires rooms after inactivity (FR-6).
 */
export class RoomManager {
  constructor({ expirationMs = 2 * 60 * 60 * 1000 } = {}) {
    this.rooms = new Map(); // code -> Room
    this.expirationMs = expirationMs;
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars 0/O, 1/I
    for (let attempts = 0; attempts < 1000; attempts++) {
      let code = '';
      for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('Unable to generate unique room code');
  }

  createRoom(hostSocketId, hostNickname) {
    this.cleanupExpiredRooms();
    const code = this.generateCode();
    const room = new Room(code, hostSocketId, hostNickname);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    if (!code) return null;
    const normalized = code.trim().toUpperCase();
    return this.rooms.get(normalized) || null;
  }

  deleteRoom(code) {
    return this.rooms.delete(code.trim().toUpperCase());
  }

  cleanupExpiredRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.lastActivityAt > this.expirationMs) {
        this.rooms.delete(code);
      }
    }
  }
}
