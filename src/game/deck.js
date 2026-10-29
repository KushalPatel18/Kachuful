/**
 * Card and Deck abstractions for Kachuful (Oh Hell).
 * Standard 52-card deck: Suits: Spades (S), Hearts (H), Clubs (C), Diamonds (D).
 * Ranks: 2 to 14 (Ace = 14, King = 13, Queen = 12, Jack = 11, 10..2).
 */

export const SUITS = ['S', 'H', 'C', 'D']; // Spades, Hearts, Clubs, Diamonds
export const SUIT_NAMES = {
  S: 'Spades',
  H: 'Hearts',
  C: 'Clubs',
  D: 'Diamonds',
  NT: 'No Trump'
};

export const RANK_NAMES = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

/**
 * Creates a card object.
 * @param {string} suit - 'S' | 'H' | 'C' | 'D'
 * @param {number} rank - 2 to 14
 */
export function createCard(suit, rank) {
  if (!SUITS.includes(suit)) {
    throw new Error(`Invalid suit: ${suit}`);
  }
  if (!Number.isInteger(rank) || rank < 2 || rank > 14) {
    throw new Error(`Invalid rank: ${rank}. Expected integer between 2 and 14.`);
  }
  return {
    suit,
    rank,
    id: `${suit}_${rank}`,
    label: `${RANK_NAMES[rank]}${suit}`
  };
}

/**
 * Creates a standard 52-card deck.
 * @returns {Array<{suit: string, rank: number, id: string, label: string}>}
 */
export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push(createCard(suit, rank));
    }
  }
  return deck;
}

/**
 * Shuffles an array of cards using Fisher-Yates shuffle.
 * Accepts an optional custom random function for deterministic testing.
 * @param {Array} cards
 * @param {Function} [randomFn=Math.random]
 * @returns {Array} new shuffled array
 */
export function shuffleDeck(cards, randomFn = Math.random) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Compares two cards for sorting a player's hand.
 * Grouped by suit (S, H, C, D) then ascending rank (2 to 14 / Ace high).
 */
export function compareCards(a, b) {
  const suitOrder = { S: 0, H: 1, C: 2, D: 3 };
  if (suitOrder[a.suit] !== suitOrder[b.suit]) {
    return suitOrder[a.suit] - suitOrder[b.suit];
  }
  return a.rank - b.rank;
}

/**
 * Sorts hand in place or returns sorted copy.
 */
export function sortHand(hand) {
  return [...hand].sort(compareCards);
}
