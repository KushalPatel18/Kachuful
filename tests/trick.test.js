import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from '../src/game/deck.js';
import {
  validateCardPlay,
  determineTrickWinner,
  getLegalPlays
} from '../src/game/trick.js';

test('Trick - mandatory follow suit validation', () => {
  const hand = [
    createCard('H', 10),
    createCard('H', 14),
    createCard('S', 5),
    createCard('C', 7)
  ];

  // First card of trick: can lead anything
  const leadResult = validateCardPlay(createCard('S', 5), hand, []);
  assert.equal(leadResult.valid, true);

  // Trick led with Hearts
  const trickWithHeartLed = [
    { playerId: 'p1', card: createCard('H', 7) }
  ];

  // Playing Heart is valid
  const followHeart = validateCardPlay(createCard('H', 10), hand, trickWithHeartLed);
  assert.equal(followHeart.valid, true);

  // Trying to play Spades when having Hearts in hand is ILLEGAL
  const illegalSpade = validateCardPlay(createCard('S', 5), hand, trickWithHeartLed);
  assert.equal(illegalSpade.valid, false);
  assert.match(illegalSpade.error, /Must follow suit/);

  // Hand without any Hearts
  const noHeartsHand = [
    createCard('S', 5),
    createCard('C', 7)
  ];

  // When player has no cards of led suit, playing trump or off-suit is valid
  const legalSpade = validateCardPlay(createCard('S', 5), noHeartsHand, trickWithHeartLed);
  assert.equal(legalSpade.valid, true);
});

test('Trick - getLegalPlays filters to led suit if available', () => {
  const hand = [
    createCard('H', 10),
    createCard('H', 14),
    createCard('S', 5),
    createCard('C', 7)
  ];
  const trick = [{ playerId: 'p1', card: createCard('H', 2) }];
  const legal = getLegalPlays(hand, trick);
  assert.equal(legal.length, 2);
  assert.deepEqual(legal.map(c => c.label), ['10H', 'AH']);
});

test('Trick Winner - highest card of led suit wins when no trumps played', () => {
  const trick = [
    { playerId: 'p1', card: createCard('H', 7) },  // Lead
    { playerId: 'p2', card: createCard('H', 13) }, // King of Hearts
    { playerId: 'p3', card: createCard('H', 10) }, // 10 of Hearts
    { playerId: 'p4', card: createCard('C', 14) }  // Ace of Clubs (off suit, non-trump)
  ];

  // Trump is Spades ('S')
  const winner = determineTrickWinner(trick, 'S');
  assert.equal(winner.playerId, 'p2'); // Highest heart (King) wins
  assert.equal(winner.card.id, 'H_13');
});

test('Trick Winner - highest trump wins regardless of led suit', () => {
  const trick = [
    { playerId: 'p1', card: createCard('H', 14) }, // Ace of Hearts (Lead)
    { playerId: 'p2', card: createCard('S', 2) },  // 2 of Spades (Trump)
    { playerId: 'p3', card: createCard('S', 8) },  // 8 of Spades (Higher Trump)
    { playerId: 'p4', card: createCard('H', 9) }   // 9 of Hearts
  ];

  const winner = determineTrickWinner(trick, 'S');
  assert.equal(winner.playerId, 'p3'); // Highest trump (8 of Spades)
  assert.equal(winner.card.id, 'S_8');
});

test('Trick Winner - No-trump (NT) round respects only led suit', () => {
  const trick = [
    { playerId: 'p1', card: createCard('D', 10) }, // Lead Diamond
    { playerId: 'p2', card: createCard('D', 12) }, // Queen Diamond
    { playerId: 'p3', card: createCard('S', 14) }, // Ace Spades (off-suit)
    { playerId: 'p4', card: createCard('D', 8) }
  ];

  const winner = determineTrickWinner(trick, 'NT');
  assert.equal(winner.playerId, 'p2'); // Queen of Diamonds wins
});
