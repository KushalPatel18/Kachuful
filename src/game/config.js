/**
 * Configuration options and rules builder for Kachuful.
 * Fully configurable according to Section 5 & Section 12 of PRD:
 * - Scoring formulas: 'standard' (10 + bid), 'ten_times' (10 * bid), 'diff_penalty'
 * - Round sequences: 'up_down' (1 to max to 1), 'down_up' (max to 1 to max), 'up_only' (1 to max), 'down_only' (max to 1)
 * - Trump selection: 'turn_up' (top remaining card turned up), 'fixed_rotation' (S -> D -> C -> H -> NT...), 'no_trump_last'
 * - Bidding restriction: dealer cannot make sum of bids equal tricks (on/off)
 * - Max cards per round cap
 */

export const SCORING_MODES = {
  STANDARD: 'standard', // 10 + bid on exact, 0 on miss
  TEN_TIMES: 'ten_times', // 10 * bid on exact, 0 on miss
  DIFF_PENALTY: 'diff_penalty' // 10 + bid on exact, -abs(tricks - bid) on miss
};

export const ROUND_SEQUENCES = {
  UP_DOWN: 'up_down', // 1 -> max -> 1
  DOWN_UP: 'down_up', // max -> 1 -> max
  UP_ONLY: 'up_only',   // 1 -> max
  DOWN_ONLY: 'down_only' // max -> 1
};

export const TRUMP_SELECTION = {
  TURN_UP: 'turn_up', // The card which reveal first is the trump card (turn up top card)
  ROTATION: 'rotation', // Fixed trump card (♠ ♦ ♣ ♥ NT)
  FIXED_ROTATION: 'fixed_rotation', // Alias for rotation
  NO_TRUMP_LAST: 'no_trump_last' // Turn-up, except last round of max cards is No Trump
};

export const FIXED_ROTATION_SUITS = ['S', 'D', 'C', 'H', 'NT'];

/**
 * Returns default configuration merged with user overrides.
 * @param {Object} [customOptions={}]
 * @param {number} [playerCount=4]
 */
export function getGameConfig(customOptions = {}, playerCount = 4) {
  const maxPossibleCards = Math.floor(52 / playerCount);
  let maxCardsCap = maxPossibleCards;
  if (customOptions.maxCardsCap !== undefined) {
    maxCardsCap = Math.min(Number(customOptions.maxCardsCap), maxPossibleCards);
  } else {
    // Default to max possible unless specified
    maxCardsCap = maxPossibleCards;
  }

  // Normalize trumpSelection
  let trumpSelection = customOptions.trumpSelection || TRUMP_SELECTION.ROTATION;
  if (trumpSelection === 'fixed_rotation') trumpSelection = TRUMP_SELECTION.ROTATION;

  return {
    minPlayers: 3,
    maxPlayers: 8,
    biddingRestriction: customOptions.biddingRestriction !== undefined ? !!customOptions.biddingRestriction : true,
    scoringMode: customOptions.scoringMode || SCORING_MODES.STANDARD,
    roundSequence: customOptions.roundSequence || ROUND_SEQUENCES.UP_DOWN,
    trumpSelection,
    maxCardsCap,
    // Custom scoring formula hook if user specifies a custom function
    calculateScore: customOptions.customScoringFn || null
  };
}

/**
 * Generates the array of card counts for each round in a game.
 * @param {string} sequenceType - 'up_down' | 'down_up' | 'up_only' | 'down_only'
 * @param {number} maxCards - Maximum cards in a round
 * @returns {number[]} Array of card counts per round
 */
export function generateRoundSequence(sequenceType = ROUND_SEQUENCES.UP_DOWN, maxCards = 13) {
  if (maxCards < 1) throw new Error('maxCards must be at least 1');

  switch (sequenceType) {
    case ROUND_SEQUENCES.UP_ONLY: {
      const rounds = [];
      for (let i = 1; i <= maxCards; i++) rounds.push(i);
      return rounds;
    }
    case ROUND_SEQUENCES.DOWN_ONLY: {
      const rounds = [];
      for (let i = maxCards; i >= 1; i--) rounds.push(i);
      return rounds;
    }
    case ROUND_SEQUENCES.DOWN_UP: {
      const rounds = [];
      for (let i = maxCards; i >= 1; i--) rounds.push(i);
      for (let i = 2; i <= maxCards; i++) rounds.push(i);
      return rounds;
    }
    case ROUND_SEQUENCES.UP_DOWN:
    default: {
      const rounds = [];
      for (let i = 1; i <= maxCards; i++) rounds.push(i);
      for (let i = maxCards - 1; i >= 1; i--) rounds.push(i);
      return rounds;
    }
  }
}

/**
 * Calculates score for a player based on bid, tricks won, and scoring configuration.
 * @param {number} bid
 * @param {number} tricksWon
 * @param {string|Function} scoringMode
 * @returns {number} Score earned in this round
 */
export function calculateRoundScore(bid, tricksWon, scoringMode = SCORING_MODES.STANDARD) {
  if (typeof scoringMode === 'function') {
    return scoringMode(bid, tricksWon);
  }

  const isExact = bid === tricksWon;

  switch (scoringMode) {
    case SCORING_MODES.TEN_TIMES:
      return isExact ? (bid === 0 ? 10 : bid * 10) : 0;
    case SCORING_MODES.DIFF_PENALTY:
      return isExact ? (10 + bid) : -Math.abs(tricksWon - bid);
    case SCORING_MODES.STANDARD:
    default:
      return isExact ? (10 + bid) : 0;
  }
}
