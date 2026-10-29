/**
 * Bot AI logic for Kachuful (Judgement).
 * Implements bidding heuristics and legal card play heuristics.
 */

import { getLegalPlays } from './trick.js';

export const BOT_NAMES = ['Bot Arya', 'Bot Kabir', 'Bot Rohan', 'Bot Diya', 'Bot Neha', 'Bot Veer', 'Bot Ananya'];

/**
 * Predicts a reasonable bid for a bot hand.
 * @param {Array<{suit: string, rank: number}>} hand
 * @param {string} trumpSuit - 'S'|'D'|'C'|'H'|'NT'
 * @param {number[]} legalBids - list of permitted bids (taking dealer restriction into account)
 * @returns {number} chosen bid
 */
export function calculateBotBid(hand, trumpSuit, legalBids) {
  if (!legalBids || legalBids.length === 0) return 0;

  let estimatedWins = 0;

  for (const card of hand) {
    const isTrump = card.suit === trumpSuit;
    if (isTrump) {
      if (card.rank >= 13) estimatedWins += 1.0;      // Ace or King of trump
      else if (card.rank >= 11) estimatedWins += 0.8; // Queen or Jack of trump
      else if (card.rank >= 8) estimatedWins += 0.5;
      else estimatedWins += 0.25;
    } else {
      if (card.rank === 14) estimatedWins += 0.85;     // Ace of off-suit
      else if (card.rank === 13) estimatedWins += 0.45; // King of off-suit
      else if (card.rank >= 11) estimatedWins += 0.15;
    }
  }

  let idealBid = Math.round(estimatedWins);

  // If idealBid is directly in legalBids, pick it
  if (legalBids.includes(idealBid)) {
    return idealBid;
  }

  // Otherwise pick closest legal bid
  let bestBid = legalBids[0];
  let minDiff = Math.abs(bestBid - idealBid);
  for (const b of legalBids) {
    const diff = Math.abs(b - idealBid);
    if (diff < minDiff) {
      minDiff = diff;
      bestBid = b;
    }
  }
  return bestBid;
}

/**
 * Picks a legal card for the bot to play.
 * Tries to win the trick if bot needs more tricks (tricksWon < bid),
 * or duck/throw low if bot already reached its bid (tricksWon >= bid).
 * 
 * @param {Array<{suit: string, rank: number}>} hand
 * @param {Array<{playerId: string, card: {suit: string, rank: number}}>} currentTrick
 * @param {string} trumpSuit
 * @param {number} bid
 * @param {number} tricksWon
 * @returns {{suit: string, rank: number}} chosen card
 */
export function chooseBotPlay(hand, currentTrick, trumpSuit, bid, tricksWon) {
  const legalPlays = getLegalPlays(hand, currentTrick);
  if (legalPlays.length === 1) {
    return legalPlays[0];
  }

  const wantsToWin = tricksWon < bid;

  // Separate legal plays
  // Sort cards ascending by rank
  const sorted = [...legalPlays].sort((a, b) => a.rank - b.rank);

  if (currentTrick.length === 0) {
    // Leading the trick
    if (wantsToWin) {
      // Lead high off-suit Ace/King, or high trump
      const offSuitAces = sorted.filter(c => c.suit !== trumpSuit && c.rank >= 13);
      if (offSuitAces.length > 0) {
        return offSuitAces[offSuitAces.length - 1];
      }
      return sorted[sorted.length - 1]; // highest card
    } else {
      // Lead lowest card to avoid winning
      return sorted[0];
    }
  }

  // Following trick: determine currently winning card in trick
  const ledSuit = currentTrick[0].card.suit;
  let highestTrumpRank = -1;
  let highestLedRank = -1;

  for (const play of currentTrick) {
    if (play.card.suit === trumpSuit) {
      if (play.card.rank > highestTrumpRank) highestTrumpRank = play.card.rank;
    } else if (play.card.suit === ledSuit && highestTrumpRank === -1) {
      if (play.card.rank > highestLedRank) highestLedRank = play.card.rank;
    }
  }

  if (wantsToWin) {
    // Find smallest card that can beat the current high
    const winningCards = sorted.filter(c => {
      if (c.suit === trumpSuit) {
        return c.rank > highestTrumpRank;
      }
      if (highestTrumpRank === -1 && c.suit === ledSuit) {
        return c.rank > highestLedRank;
      }
      return false;
    });

    if (winningCards.length > 0) {
      // Smallest card that wins
      return winningCards[0];
    }
    // Cannot win trick, discard lowest card
    return sorted[0];
  } else {
    // Do not want to win: find highest card that loses, or lowest card
    const losingCards = sorted.filter(c => {
      if (c.suit === trumpSuit) {
        return highestTrumpRank !== -1 && c.rank < highestTrumpRank;
      }
      if (c.suit === ledSuit) {
        return (highestTrumpRank !== -1) || (c.rank < highestLedRank);
      }
      // Off-suit non-trump cannot win
      return true;
    });

    if (losingCards.length > 0) {
      // Pick highest losing card to safely dump rank
      return losingCards[losingCards.length - 1];
    }

    // Forced to play a card that might win, play the lowest possible
    return sorted[0];
  }
}

