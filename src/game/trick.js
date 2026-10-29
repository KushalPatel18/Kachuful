/**
 * Trick and Card Play evaluation rules for Kachuful.
 * Follow suit is mandatory if able.
 * Winner is highest trump, else highest card of led suit.
 */

/**
 * Validates if playing a card is legal given the player's hand and current trick.
 * @param {Object} cardToPlay - { suit: string, rank: number }
 * @param {Array<Object>} hand - Array of cards currently in player's hand
 * @param {Array<Object>} currentTrick - Array of { playerId: string, card: Object }
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCardPlay(cardToPlay, hand, currentTrick = []) {
  if (!cardToPlay || !cardToPlay.suit || !cardToPlay.rank) {
    return { valid: false, error: 'Invalid card specified.' };
  }

  // Ensure card exists in player's hand
  const hasCard = hand.some(c => c.suit === cardToPlay.suit && c.rank === cardToPlay.rank);
  if (!hasCard) {
    return { valid: false, error: 'You do not hold this card in your hand.' };
  }

  // If first card of the trick (leading), any card in hand is valid
  if (!currentTrick || currentTrick.length === 0) {
    return { valid: true };
  }

  // Led suit is the suit of the first card played in the trick
  const ledSuit = currentTrick[0].card.suit;

  // If player followed led suit, always valid
  if (cardToPlay.suit === ledSuit) {
    return { valid: true };
  }

  // If player did not follow led suit, check if player has any card of led suit
  const hasLedSuit = hand.some(c => c.suit === ledSuit);
  if (hasLedSuit) {
    return {
      valid: false,
      error: `Must follow suit (${ledSuit}). You have ${ledSuit} in your hand.`
    };
  }

  // If player has no card of led suit, playing any card (trump or off-suit) is valid
  return { valid: true };
}

/**
 * Returns a list of all legal cards a player can play from their hand for the current trick.
 * Useful for client highlighting (FR-15) and server validation.
 * @param {Array<Object>} hand
 * @param {Array<Object>} currentTrick
 * @returns {Array<Object>}
 */
export function getLegalPlays(hand, currentTrick = []) {
  if (!currentTrick || currentTrick.length === 0) {
    return [...hand];
  }
  const ledSuit = currentTrick[0].card.suit;
  const cardsInLedSuit = hand.filter(c => c.suit === ledSuit);
  if (cardsInLedSuit.length > 0) {
    return cardsInLedSuit;
  }
  return [...hand];
}

/**
 * Determines the winner of a trick.
 * Rule: Highest trump wins. If no trump played, highest card of led suit wins.
 * @param {Array<{playerId: string, card: {suit: string, rank: number}}>} trickPlays
 * @param {string|null} trumpSuit - 'S' | 'H' | 'C' | 'D' | 'NT' | null
 * @returns {{ playerId: string, card: Object }} Winning play
 */
export function determineTrickWinner(trickPlays, trumpSuit) {
  if (!trickPlays || trickPlays.length === 0) {
    throw new Error('Trick is empty, cannot determine winner.');
  }

  const ledSuit = trickPlays[0].card.suit;
  let winningPlay = trickPlays[0];

  const isTrump = (suit) => trumpSuit && trumpSuit !== 'NT' && suit === trumpSuit;

  for (let i = 1; i < trickPlays.length; i++) {
    const candidate = trickPlays[i];
    const winCard = winningPlay.card;
    const candCard = candidate.card;

    const candIsTrump = isTrump(candCard.suit);
    const winIsTrump = isTrump(winCard.suit);

    if (candIsTrump && !winIsTrump) {
      // Candidate trumped an off-suit/led suit
      winningPlay = candidate;
    } else if (candIsTrump && winIsTrump) {
      // Both are trumps, compare rank (higher rank wins)
      if (candCard.rank > winCard.rank) {
        winningPlay = candidate;
      }
    } else if (!candIsTrump && !winIsTrump) {
      // Neither is trump. Only cards matching ledSuit can win.
      if (candCard.suit === ledSuit) {
        if (winCard.suit !== ledSuit || candCard.rank > winCard.rank) {
          winningPlay = candidate;
        }
      }
    }
    // If cand is not trump and winCard is trump, winningPlay remains winCard.
  }

  return winningPlay;
}
