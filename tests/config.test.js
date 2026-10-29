import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoundSequence,
  calculateRoundScore,
  ROUND_SEQUENCES,
  SCORING_MODES,
  getGameConfig
} from '../src/game/config.js';

test('Config - round sequences up_down, up_only, down_only', () => {
  // Up then down for 4 cards max: 1, 2, 3, 4, 3, 2, 1
  const upDown = generateRoundSequence(ROUND_SEQUENCES.UP_DOWN, 4);
  assert.deepEqual(upDown, [1, 2, 3, 4, 3, 2, 1]);

  // Up only for 5 cards: 1, 2, 3, 4, 5
  const upOnly = generateRoundSequence(ROUND_SEQUENCES.UP_ONLY, 5);
  assert.deepEqual(upOnly, [1, 2, 3, 4, 5]);

  // Down only for 5 cards: 5, 4, 3, 2, 1
  const downOnly = generateRoundSequence(ROUND_SEQUENCES.DOWN_ONLY, 5);
  assert.deepEqual(downOnly, [5, 4, 3, 2, 1]);

  // Down then up for 3 cards: 3, 2, 1, 2, 3
  const downUp = generateRoundSequence(ROUND_SEQUENCES.DOWN_UP, 3);
  assert.deepEqual(downUp, [3, 2, 1, 2, 3]);
});

test('Config - max cards per round calculation: floor(52 / players)', () => {
  assert.equal(getGameConfig({}, 4).maxCardsCap, 13);
  assert.equal(getGameConfig({}, 3).maxCardsCap, 17);
  assert.equal(getGameConfig({}, 5).maxCardsCap, 10);
  assert.equal(getGameConfig({}, 6).maxCardsCap, 8);
  assert.equal(getGameConfig({}, 8).maxCardsCap, 6);

  // Custom cap overrides if smaller than floor(52/players)
  assert.equal(getGameConfig({ maxCardsCap: 7 }, 4).maxCardsCap, 7);
  // Custom cap cannot exceed floor(52/players)
  assert.equal(getGameConfig({ maxCardsCap: 20 }, 4).maxCardsCap, 13);
});

test('Scoring - exact bid default (10 + bid) and missed bid (0)', () => {
  // Exact bid 0 -> 10 + 0 = 10
  assert.equal(calculateRoundScore(0, 0, SCORING_MODES.STANDARD), 10);
  // Exact bid 4 -> 10 + 4 = 14
  assert.equal(calculateRoundScore(4, 4, SCORING_MODES.STANDARD), 14);
  // Missed bid 2 (won 1) -> 0
  assert.equal(calculateRoundScore(2, 1, SCORING_MODES.STANDARD), 0);
  // Missed bid 0 (won 1) -> 0
  assert.equal(calculateRoundScore(0, 1, SCORING_MODES.STANDARD), 0);
});

test('Scoring - alternative mode: 10 * bid', () => {
  assert.equal(calculateRoundScore(3, 3, SCORING_MODES.TEN_TIMES), 30);
  assert.equal(calculateRoundScore(0, 0, SCORING_MODES.TEN_TIMES), 10);
  assert.equal(calculateRoundScore(2, 1, SCORING_MODES.TEN_TIMES), 0);
});

test('Scoring - alternative mode: negative difference penalty on miss', () => {
  // Exact bid 3 -> 10 + 3 = 13
  assert.equal(calculateRoundScore(3, 3, SCORING_MODES.DIFF_PENALTY), 13);
  // Missed bid 3 (won 1) -> -abs(1 - 3) = -2
  assert.equal(calculateRoundScore(3, 1, SCORING_MODES.DIFF_PENALTY), -2);
  // Missed bid 1 (won 4) -> -abs(4 - 1) = -3
  assert.equal(calculateRoundScore(1, 4, SCORING_MODES.DIFF_PENALTY), -3);
});
