import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState, GAME_PHASES } from '../src/game/gameState.js';
import { createCard } from '../src/game/deck.js';
import { ROUND_SEQUENCES, TRUMP_SELECTION } from '../src/game/config.js';

test('GameState - player setup, dealer rotation, and turn order', () => {
  const players = [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Charlie' },
    { id: 'p4', name: 'Diana' }
  ];

  const game = new GameState({
    players,
    rules: { roundSequence: ROUND_SEQUENCES.UP_DOWN, maxCardsCap: 3 }
  });

  game.startGame();
  assert.equal(game.phase, GAME_PHASES.BIDDING);
  assert.equal(game.currentRoundIndex, 0);
  assert.equal(game.dealerIndex, 0); // Dealer is p1
  // First bidder must be left of dealer -> p2
  assert.equal(game.currentTurnPlayerId, 'p2');
});

test('GameState - dealer bidding restriction (cannot make total bids equal tricks)', () => {
  const players = [
    { id: 'p1', name: 'Alice' },   // Dealer
    { id: 'p2', name: 'Bob' },     // Bidder 1
    { id: 'p3', name: 'Charlie' }, // Bidder 2
    { id: 'p4', name: 'Diana' }    // Bidder 3
  ];

  const game = new GameState({
    players,
    rules: { roundSequence: ROUND_SEQUENCES.UP_ONLY, maxCardsCap: 3, biddingRestriction: true }
  });
  game.startGame(); // Round 1: 1 card dealt per player, 1 trick available

  // Turn 1: p2 bids 0
  assert.equal(game.currentTurnPlayerId, 'p2');
  game.placeBid('p2', 0);

  // Turn 2: p3 bids 1
  assert.equal(game.currentTurnPlayerId, 'p3');
  game.placeBid('p3', 1);

  // Turn 3: p4 bids 0
  assert.equal(game.currentTurnPlayerId, 'p4');
  game.placeBid('p4', 0);

  // Turn 4: p1 is dealer and last bidder!
  // Current total bids = 0 + 1 + 0 = 1.
  // Total tricks = 1.
  // Therefore, dealer bid CANNOT be 1 - 1 = 0!
  assert.equal(game.currentTurnPlayerId, 'p1');
  const legalBidsForDealer = game.getLegalBids('p1');
  // For round of 1 card, possible bids are 0 and 1. 0 is forbidden.
  assert.deepEqual(legalBidsForDealer, [1]);

  // Attempting to bid 0 should throw error
  assert.throws(() => {
    game.placeBid('p1', 0);
  }, /Illegal bid: 0/);

  // Bidding 1 succeeds
  game.placeBid('p1', 1);
  assert.equal(game.phase, GAME_PHASES.PLAYING);
  // First lead is player left of dealer -> p2
  assert.equal(game.currentTurnPlayerId, 'p2');
});

test('GameState - server-authoritative privacy: client state hides other hands', () => {
  const players = [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Charlie' }
  ];

  const game = new GameState({
    players,
    rules: { roundSequence: ROUND_SEQUENCES.UP_ONLY, maxCardsCap: 2 }
  });
  game.startGame();

  const p1View = game.getClientState('p1');
  assert.ok(p1View.myHand);
  assert.equal(p1View.myHand.length, 1);

  // Public players array contains cardCount, but NO card faces or hand objects!
  for (const p of p1View.players) {
    assert.equal(typeof p.cardCount, 'number');
    assert.equal(p.hand, undefined); // Hidden
  }
});

test('GameState - full round play-through from deal to scoring', () => {
  const players = [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Charlie' }
  ];

  const game = new GameState({
    players,
    rules: { roundSequence: ROUND_SEQUENCES.UP_ONLY, maxCardsCap: 1 }
  });
  game.startGame();

  // Give known cards for deterministic test
  // Round 1: 1 card each
  game.hands.set('p1', [createCard('H', 10)]);
  game.hands.set('p2', [createCard('H', 14)]); // Ace of Hearts
  game.hands.set('p3', [createCard('H', 7)]);
  game.trumpSuit = 'S'; // Spades is trump, no one has Spades

  // Bids: p2 (dealer is p1, so order is p2, p3, p1)
  game.placeBid('p2', 1);
  game.placeBid('p3', 0);
  // Total so far: 1. Tricks: 1. Dealer p1 cannot bid 0.
  game.placeBid('p1', 1);

  // Playing: p2 leads Ace of Hearts
  const p2Play = game.playCard('p2', createCard('H', 14));
  assert.equal(p2Play.trickComplete, false);

  // p3 plays 7 of Hearts
  const p3Play = game.playCard('p3', createCard('H', 7));
  assert.equal(p3Play.trickComplete, false);

  // p1 plays 10 of Hearts
  const p1Play = game.playCard('p1', createCard('H', 10));
  assert.equal(p1Play.trickComplete, true);
  assert.equal(p1Play.roundComplete, true);
  assert.equal(p1Play.trickWinner.playerId, 'p2');

  // Verify scoring:
  // p2 bid 1, won 1 -> 10 + 1 = 11 pts
  // p3 bid 0, won 0 -> 10 + 0 = 10 pts
  // p1 bid 1, won 0 -> 0 pts
  assert.equal(game.scores.get('p2'), 11);
  assert.equal(game.scores.get('p3'), 10);
  assert.equal(game.scores.get('p1'), 0);

  // Since round was 1 max card and up_only, game is over
  assert.equal(game.phase, GAME_PHASES.GAME_OVER);
});
