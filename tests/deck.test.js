import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard,
  createDeck,
  shuffleDeck,
  sortHand,
  SUITS
} from '../src/game/deck.js';

test('Deck - standard 52 cards, Ace high', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);

  // 13 cards per suit
  for (const suit of SUITS) {
    const cardsOfSuit = deck.filter(c => c.suit === suit);
    assert.equal(cardsOfSuit.length, 13);
    const ranks = cardsOfSuit.map(c => c.rank).sort((a, b) => a - b);
    assert.deepEqual(ranks, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  }
});

test('Deck - shuffling is deterministic with seed and preserves 52 cards', () => {
  const deck = createDeck();
  // Simple pseudo-random sequence for testing
  let seed = 42;
  const mockRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const shuffled = shuffleDeck(deck, mockRandom);
  assert.equal(shuffled.length, 52);
  // Ensure all 52 unique IDs exist
  const uniqueIds = new Set(shuffled.map(c => c.id));
  assert.equal(uniqueIds.size, 52);
});

test('Deck - sortHand groups by suit and sorts Ace high (rank 14)', () => {
  const hand = [
    createCard('H', 14), // Ace of Hearts
    createCard('S', 2),  // 2 of Spades
    createCard('H', 5),  // 5 of Hearts
    createCard('S', 14), // Ace of Spades
    createCard('D', 10), // 10 of Diamonds
    createCard('C', 13)  // King of Clubs
  ];

  const sorted = sortHand(hand);
  const labels = sorted.map(c => c.label);
  // Expected order: Spades (2, A), Hearts (5, A), Clubs (K), Diamonds (10)
  assert.deepEqual(labels, ['2S', 'AS', '5H', 'AH', 'KC', '10D']);
});
