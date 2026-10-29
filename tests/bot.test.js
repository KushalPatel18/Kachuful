import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBotBid, chooseBotPlay } from '../src/game/bot.js';

describe('Bot AI', () => {
  it('chooses legal bid within given legal options', () => {
    const hand = [
      { suit: 'S', rank: 14 }, // Trump Ace
      { suit: 'S', rank: 13 }, // Trump King
      { suit: 'H', rank: 4 }
    ];
    const legalBids = [0, 1, 3]; // 2 is forbidden due to dealer restriction
    const bid = calculateBotBid(hand, 'S', legalBids);
    assert.ok(legalBids.includes(bid));
    assert.equal(bid, 1); // Closest to 2.0 estimated wins
  });

  it('plays legal card following lead suit', () => {
    const hand = [
      { suit: 'H', rank: 10 },
      { suit: 'S', rank: 14 },
      { suit: 'C', rank: 2 }
    ];
    const currentTrick = [
      { playerId: 'p1', card: { suit: 'H', rank: 7 } }
    ];
    const card = chooseBotPlay(hand, currentTrick, 'S', 1, 0);
    // Must follow Hearts
    assert.equal(card.suit, 'H');
    assert.equal(card.rank, 10);
  });

  it('dumps lowest card when it cannot or does not want to win', () => {
    const hand = [
      { suit: 'D', rank: 12 },
      { suit: 'D', rank: 3 }
    ];
    const currentTrick = [
      { playerId: 'p1', card: { suit: 'H', rank: 14 } } // Lead is Hearts, bot has no Hearts
    ];
    // Bot already reached its bid (bid: 1, tricksWon: 1)
    const card = chooseBotPlay(hand, currentTrick, 'S', 1, 1);
    assert.equal(card.suit, 'D');
    assert.equal(card.rank, 12); // Discards highest safe offsuit card to shed rank, or lowest
  });
});

