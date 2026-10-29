/**
 * GameState: Pure game-logic engine for Kachuful.
 * Manages full game progression:
 * - Player seats
 * - Dealer rotation
 * - Deal cards per round count
 * - Trump selection (turn_up, rotation, no_trump_last)
 * - Bidding restriction (dealer cannot make sum of bids equal tricks in round)
 * - Turn enforcement (bidding turn and trick play turn)
 * - Trick collection and tricks won tracking
 * - Scoring calculation and round summary
 * - Game over detection
 * - Client-safe state serialization (omits other players' hands)
 */

import { createDeck, shuffleDeck, sortHand } from './deck.js';
import {
  getGameConfig,
  generateRoundSequence,
  calculateRoundScore,
  SCORING_MODES,
  ROUND_SEQUENCES,
  TRUMP_SELECTION,
  FIXED_ROTATION_SUITS
} from './config.js';
import { validateCardPlay, determineTrickWinner, getLegalPlays } from './trick.js';

export const GAME_PHASES = {
  NOT_STARTED: 'NOT_STARTED',
  BIDDING: 'BIDDING',
  PLAYING: 'PLAYING',
  ROUND_ENDED: 'ROUND_ENDED',
  GAME_OVER: 'GAME_OVER'
};

export class GameState {
  /**
   * @param {Object} options
   * @param {Array<{id: string, name: string}>} [options.players]
   * @param {Object} [options.rules]
   * @param {Function} [options.randomFn]
   */
  constructor({ players = [], rules = {}, randomFn = Math.random } = {}) {
    this.players = [...players]; // [{ id, name }]
    this.randomFn = randomFn;
    this.rules = getGameConfig(rules, this.players.length || 4);

    this.rounds = [];
    this.currentRoundIndex = -1;
    this.dealerIndex = 0; // Rotates each round
    this.phase = GAME_PHASES.NOT_STARTED;

    // Per-round state
    this.hands = new Map(); // playerId -> card[]
    this.trumpCard = null; // Card turned up (or null)
    this.trumpSuit = null; // 'S'|'H'|'C'|'D'|'NT'
    this.bids = new Map(); // playerId -> number
    this.tricksWon = new Map(); // playerId -> number
    this.currentTrick = []; // [{ playerId, card }]
    this.lastCompletedTrick = null; // { winner: { playerId }, plays: [] } — shown until next card played
    this.currentTurnPlayerId = null;
    this.firstLeadPlayerId = null;

    // Overall game scores: playerId -> totalScore
    this.scores = new Map();
    // History of round results
    this.roundHistory = [];

    this._initPlayers();
  }

  _initPlayers() {
    this.scores.clear();
    for (const p of this.players) {
      this.scores.set(p.id, 0);
    }
  }

  /**
   * Add a player before game starts.
   */
  addPlayer(id, name) {
    if (this.phase !== GAME_PHASES.NOT_STARTED) {
      throw new Error('Cannot add player after game has started');
    }
    if (this.players.length >= this.rules.maxPlayers) {
      throw new Error(`Room full (max ${this.rules.maxPlayers} players)`);
    }
    if (this.players.some(p => p.id === id)) {
      throw new Error(`Player ${id} already in game`);
    }
    this.players.push({ id, name });
    this.scores.set(id, 0);
    // Recalculate max cards cap based on player count
    this.rules = getGameConfig(this.rules, this.players.length);
  }

  /**
   * Starts the game, generates round sequence, and begins round 1.
   */
  startGame() {
    if (this.players.length < this.rules.minPlayers) {
      throw new Error(`Need at least ${this.rules.minPlayers} players to start. Current: ${this.players.length}`);
    }
    this.rounds = generateRoundSequence(this.rules.roundSequence, this.rules.maxCardsCap);
    this.currentRoundIndex = -1;
    this.dealerIndex = 0;
    this.roundHistory = [];
    this._initPlayers();
    this.startNextRound();
  }

  /**
   * Starts the next round in sequence.
   */
  startNextRound() {
    this.currentRoundIndex++;
    if (this.currentRoundIndex >= this.rounds.length) {
      this.phase = GAME_PHASES.GAME_OVER;
      this.currentTurnPlayerId = null;
      return;
    }

    // Dealer rotates left each round (dealerIndex increments % players.length)
    if (this.currentRoundIndex > 0) {
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    }

    const cardsToDeal = this.rounds[this.currentRoundIndex];
    this.dealRound(cardsToDeal);
  }

  /**
   * Deals cards and sets up trump and bidding phase.
   * @param {number} cardsCount
   */
  dealRound(cardsCount) {
    const fullDeck = shuffleDeck(createDeck(), this.randomFn);
    this.hands.clear();
    this.bids.clear();
    this.tricksWon.clear();
    this.currentTrick = [];
    this.lastCompletedTrick = null;

    for (const p of this.players) {
      this.hands.set(p.id, []);
      this.tricksWon.set(p.id, 0);
    }

    // Deal cardsCount cards to each player starting left of dealer
    let deckIndex = 0;
    for (let i = 0; i < cardsCount; i++) {
      for (let pOffset = 1; pOffset <= this.players.length; pOffset++) {
        const pIdx = (this.dealerIndex + pOffset) % this.players.length;
        const pId = this.players[pIdx].id;
        this.hands.get(pId).push(fullDeck[deckIndex++]);
      }
    }

    // Sort every player's hand
    for (const p of this.players) {
      this.hands.set(p.id, sortHand(this.hands.get(p.id)));
    }

    // Determine Trump
    this._determineTrump(fullDeck, deckIndex, cardsCount);

    // Bidding starts with the player left of the dealer
    const firstBidderIdx = (this.dealerIndex + 1) % this.players.length;
    this.currentTurnPlayerId = this.players[firstBidderIdx].id;
    this.firstLeadPlayerId = this.players[firstBidderIdx].id;
    this.phase = GAME_PHASES.BIDDING;
  }

  _determineTrump(deck, deckIndex, cardsCount) {
    const isLastRound = this.currentRoundIndex === this.rounds.length - 1;

    if (this.rules.trumpSelection === TRUMP_SELECTION.ROTATION) {
      // Rotation: e.g. S -> D -> C -> H -> NT
      const suit = FIXED_ROTATION_SUITS[this.currentRoundIndex % FIXED_ROTATION_SUITS.length];
      this.trumpSuit = suit;
      this.trumpCard = null;
    } else if (this.rules.trumpSelection === TRUMP_SELECTION.NO_TRUMP_LAST && isLastRound) {
      this.trumpSuit = 'NT';
      this.trumpCard = null;
    } else {
      // Default: Top card of the remaining deck is turned up
      if (deckIndex < deck.length) {
        this.trumpCard = deck[deckIndex];
        this.trumpSuit = deck[deckIndex].suit;
      } else {
        // If 52 cards dealt exactly (e.g. 4 players x 13 cards), no remaining card
        this.trumpCard = null;
        this.trumpSuit = 'NT'; // No Trump when whole deck is dealt
      }
    }
  }

  /**
   * Get valid bids a player can make right now.
   * Enforces the dealer's bidding restriction if enabled.
   * @param {string} playerId
   * @returns {number[]} Array of legal bid numbers
   */
  getLegalBids(playerId) {
    if (this.phase !== GAME_PHASES.BIDDING) return [];
    if (this.currentTurnPlayerId !== playerId) return [];

    const cardsInRound = this.rounds[this.currentRoundIndex];
    const legalBids = [];
    const isDealer = this.players[this.dealerIndex].id === playerId;
    const isLastBidder = this.bids.size === this.players.length - 1;

    let forbiddenBid = null;
    if (this.rules.biddingRestriction && isDealer && isLastBidder) {
      let currentTotal = 0;
      for (const b of this.bids.values()) {
        currentTotal += b;
      }
      forbiddenBid = cardsInRound - currentTotal;
    }

    for (let b = 0; b <= cardsInRound; b++) {
      if (forbiddenBid !== null && b === forbiddenBid) {
        continue;
      }
      legalBids.push(b);
    }
    return legalBids;
  }

  /**
   * Place a bid for the current player.
   * @param {string} playerId
   * @param {number} bid
   */
  placeBid(playerId, bid) {
    if (this.phase !== GAME_PHASES.BIDDING) {
      throw new Error(`Cannot bid during phase: ${this.phase}`);
    }
    if (this.currentTurnPlayerId !== playerId) {
      throw new Error(`Not your turn to bid. Current turn: ${this.currentTurnPlayerId}`);
    }

    const cardsInRound = this.rounds[this.currentRoundIndex];
    if (!Number.isInteger(bid) || bid < 0 || bid > cardsInRound) {
      throw new Error(`Bid must be an integer between 0 and ${cardsInRound}`);
    }

    const legalBids = this.getLegalBids(playerId);
    if (!legalBids.includes(bid)) {
      throw new Error(
        `Illegal bid: ${bid}. As the dealer, your bid cannot make total bids equal the number of tricks (${cardsInRound}).`
      );
    }

    this.bids.set(playerId, bid);

    // Check if bidding is complete
    if (this.bids.size === this.players.length) {
      // Transition to PLAYING
      this.phase = GAME_PHASES.PLAYING;
      // First lead is player left of dealer
      const firstLeaderIdx = (this.dealerIndex + 1) % this.players.length;
      this.currentTurnPlayerId = this.players[firstLeaderIdx].id;
    } else {
      // Advance to next bidder (clockwise / left)
      const currentIdx = this.players.findIndex(p => p.id === playerId);
      const nextIdx = (currentIdx + 1) % this.players.length;
      this.currentTurnPlayerId = this.players[nextIdx].id;
    }

    return { success: true };
  }

  /**
   * Play a card for the current player.
   * @param {string} playerId
   * @param {{suit: string, rank: number}} card
   * @returns {{ success: boolean, trickComplete: boolean, trickWinner?: Object, roundComplete: boolean }}
   */
  playCard(playerId, card) {
    if (this.phase !== GAME_PHASES.PLAYING) {
      throw new Error(`Cannot play card during phase: ${this.phase}`);
    }
    if (this.currentTurnPlayerId !== playerId) {
      throw new Error(`Not your turn to play. Current turn: ${this.currentTurnPlayerId}`);
    }

    const hand = this.hands.get(playerId) || [];
    const validation = validateCardPlay(card, hand, this.currentTrick);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Remove card from player hand
    const cardIdx = hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
    const [playedCard] = hand.splice(cardIdx, 1);

    // Clear the last completed trick display as soon as a new card is played
    if (this.currentTrick.length === 0) {
      this.lastCompletedTrick = null;
    }

    // Add to current trick
    this.currentTrick.push({ playerId, card: playedCard });

    // Check if trick is complete (all players played 1 card)
    if (this.currentTrick.length === this.players.length) {
      const winner = determineTrickWinner(this.currentTrick, this.trumpSuit);
      const prevTricks = this.tricksWon.get(winner.playerId) || 0;
      this.tricksWon.set(winner.playerId, prevTricks + 1);

      const completedTrick = [...this.currentTrick];
      this.currentTrick = [];

      // Remember this trick for display until next card is played
      this.lastCompletedTrick = { winner, plays: completedTrick };

      // Next lead is the winner of this trick
      this.currentTurnPlayerId = winner.playerId;

      // Check if round is complete (all cards played)
      const anyCardsLeft = Array.from(this.hands.values()).some(h => h.length > 0);
      if (!anyCardsLeft) {
        this._finishRound();
        return {
          success: true,
          trickComplete: true,
          trickWinner: winner,
          completedTrick,
          roundComplete: true
        };
      }

      return {
        success: true,
        trickComplete: true,
        trickWinner: winner,
        completedTrick,
        roundComplete: false
      };
    } else {
      // Advance to next player left (clockwise)
      const currentIdx = this.players.findIndex(p => p.id === playerId);
      const nextIdx = (currentIdx + 1) % this.players.length;
      this.currentTurnPlayerId = this.players[nextIdx].id;

      return {
        success: true,
        trickComplete: false,
        roundComplete: false
      };
    }
  }

  /**
   * Finalizes round scores and updates running score.
   */
  _finishRound() {
    this.phase = GAME_PHASES.ROUND_ENDED;
    this.currentTurnPlayerId = null;

    const roundScoreSummary = {};
    for (const p of this.players) {
      const bid = this.bids.get(p.id) ?? 0;
      const won = this.tricksWon.get(p.id) ?? 0;
      const points = calculateRoundScore(bid, won, this.rules.scoringMode);
      const previousTotal = this.scores.get(p.id) || 0;
      const newTotal = previousTotal + points;
      this.scores.set(p.id, newTotal);

      roundScoreSummary[p.id] = {
        bid,
        tricksWon: won,
        pointsEarned: points,
        totalScore: newTotal
      };
    }

    this.roundHistory.push({
      roundNumber: this.currentRoundIndex + 1,
      cardsCount: this.rounds[this.currentRoundIndex],
      dealer: this.players[this.dealerIndex].id,
      trumpSuit: this.trumpSuit,
      results: roundScoreSummary
    });

    if (this.currentRoundIndex === this.rounds.length - 1) {
      this.phase = GAME_PHASES.GAME_OVER;
    }
  }

  /**
   * Safe public state visible to all players.
   * Client-authoritative safe: Never includes other players' hands!
   * @param {string} forPlayerId - ID of player requesting state
   * @returns {Object} Safe state object
   */
  getClientState(forPlayerId) {
    const playerHand = this.hands.get(forPlayerId) || [];
    const legalPlays = (this.phase === GAME_PHASES.PLAYING && this.currentTurnPlayerId === forPlayerId)
      ? getLegalPlays(playerHand, this.currentTrick)
      : [];

    const legalBids = (this.phase === GAME_PHASES.BIDDING && this.currentTurnPlayerId === forPlayerId)
      ? this.getLegalBids(forPlayerId)
      : [];

    return {
      phase: this.phase,
      roundNumber: this.currentRoundIndex + 1,
      totalRounds: this.rounds.length,
      cardsInRound: this.rounds[this.currentRoundIndex] || 0,
      dealer: this.players[this.dealerIndex] ? this.players[this.dealerIndex].id : null,
      trumpSuit: this.trumpSuit,
      trumpCard: this.trumpCard,
      currentTurn: this.currentTurnPlayerId,
      currentTrick: this.currentTrick,
      lastCompletedTrick: this.lastCompletedTrick,
      // Current player's private hand
      myHand: playerHand,
      myLegalPlays: legalPlays,
      myLegalBids: legalBids,
      // Public info about all players (card counts only, no faces!)
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: (this.hands.get(p.id) || []).length,
        bid: this.bids.has(p.id) ? this.bids.get(p.id) : null,
        tricksWon: this.tricksWon.get(p.id) ?? 0,
        totalScore: this.scores.get(p.id) ?? 0
      })),
      roundHistory: this.roundHistory
    };
  }
}
