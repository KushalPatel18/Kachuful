/**
 * Kachuful Online — Frontend Client (Phase 3)
 * Handles: room flow, real-time game state, bidding, card play,
 * trick winner display, live scoreboard, round summary, game over.
 */

const SUIT_SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦', NT: 'NT' };
const SUIT_NAMES   = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds', NT: 'No Trump' };
const RANK_LABELS  = {
  2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',
  11:'J',12:'Q',13:'K',14:'A'
};

// ─── App state ────────────────────────────────────────────────────────────────
const S = {
  socket: null,
  roomCode: null,
  token: null,
  playerId: null,
  nickname: '',
  isHost: false,
  gameState: null
};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = {
  home:  $('screen-home'),
  lobby: $('screen-lobby'),
  game:  $('screen-game')
};

// Home
const inputNickname = $('input-nickname');
const inputRoomCode = $('input-room-code');

// Header
const headerRoomPill = $('header-room-pill');
const headerRoomCode = $('header-room-code');

// Lobby
const lobbyRoomCode    = $('lobby-room-code');
const lobbyPlayerCount = $('lobby-player-count');
const lobbyPlayerList  = $('lobby-player-list');
const btnStartGame     = $('btn-start-game');
const formRules        = $('form-rules');
const ruleSequence     = $('rule-sequence');
const ruleMaxCards     = $('rule-max-cards');
const ruleTrump        = $('rule-trump');
const ruleScoring      = $('rule-scoring');
const ruleBiddingRestriction = $('rule-bidding-restriction');

// HUD
const hudRound       = $('hud-round-number');
const hudTrumpIcon   = $('hud-trump-suit-icon');
const hudTrumpName   = $('hud-trump-name');
const hudDealerName  = $('hud-dealer-name');
const hudCurrentTurn = $('hud-current-turn');

// Arena
const opponentsBar        = $('opponents-bar');
const trickCardsContainer = $('trick-cards-container');
const trickWinnerBanner   = $('trick-winner-banner');
const trickWinnerText     = $('trick-winner-text');
const biddingTray         = $('bidding-tray');
const bidHint             = $('bidding-hint');
const bidButtonsGrid      = $('bid-buttons-grid');

// Hand
const playerHandEl   = $('player-hand');
const handCardsCount = $('hand-cards-count');
const handInstruction = $('hand-instruction');

// Scoreboard
const scoreboardBody = $('scoreboard-body');

// Modals
const modalRoundSummary  = $('modal-round-summary');
const summaryRoundTitle  = $('summary-round-title');
const summaryTableBody   = $('summary-table-body');
const btnNextRound       = $('btn-next-round');
const modalGameOver      = $('modal-game-over');
const gameOverWinner     = $('game-over-winner');
const gameOverTableBody  = $('game-over-table-body');
const toastContainer     = $('toast-container');

// ─── Utilities ────────────────────────────────────────────────────────────────
function showScreen(key) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  if (screens[key]) screens[key].classList.remove('hidden');
}

function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = `toast${isErr ? ' toast-error' : ''}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function html(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function suitClass(suit) {
  return (suit === 'H' || suit === 'D') ? 'suit-red' : 'suit-black';
}

function updateHeaderRoom(code) {
  if (code) {
    headerRoomCode.textContent = code;
    headerRoomPill.classList.remove('hidden');
  } else {
    headerRoomPill.classList.add('hidden');
  }
}

function copyRoomLink() {
  if (!S.roomCode) return;
  const url = `${location.origin}/?room=${S.roomCode}`;
  navigator.clipboard.writeText(url)
    .then(() => toast('Invite link copied!'))
    .catch(() => toast(url)); // fallback: show the URL
}

// ─── Card rendering ───────────────────────────────────────────────────────────
function makeCard(card) {
  const rank = RANK_LABELS[card.rank] || card.rank;
  const sym  = SUIT_SYMBOLS[card.suit] || card.suit;
  const div  = document.createElement('div');
  div.className = `card suit-${card.suit}`;
  div.innerHTML = `
    <div class="card-top">
      <span class="card-rank">${rank}</span>
      <span class="card-suit-sm">${sym}</span>
    </div>
    <div class="card-center">${sym}</div>`;
  return div;
}

// ─── Socket initialization ────────────────────────────────────────────────────
function init() {
  S.socket = io();

  // Pre-fill room code from ?room=XXXXX invite URL
  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) inputRoomCode.value = urlCode.toUpperCase();

  // Restore nickname from localStorage
  const savedNick = localStorage.getItem('kachuful_nick');
  if (savedNick) inputNickname.value = savedNick;

  // Try to reconnect previous session
  const savedToken = localStorage.getItem('kachuful_token');
  const savedRoom  = localStorage.getItem('kachuful_room');
  if (savedToken && savedRoom) {
    S.socket.emit('reconnect_session', { roomCode: savedRoom, token: savedToken }, res => {
      if (res?.success) {
        S.roomCode  = savedRoom;
        S.token     = savedToken;
        S.playerId  = res.playerId;
        updateHeaderRoom(savedRoom);
        if (res.isGameStarted) {
          showScreen('game');
        } else {
          showScreen('lobby');
          renderLobby(res.lobbyState);
        }
      }
    });
  }

  bindSocketEvents();
  bindUIEvents();
}

// ─── Socket event handlers ────────────────────────────────────────────────────
function bindSocketEvents() {
  const { socket } = S;

  socket.on('lobby_update', lobbyState => {
    if (!screens.game.classList.contains('hidden')) return; // in-game ignore
    showScreen('lobby');
    renderLobby(lobbyState);
  });

  socket.on('state_update', gameState => {
    S.gameState = gameState;
    showScreen('game');
    renderGame(gameState);
  });
}

// ─── UI event bindings ────────────────────────────────────────────────────────
function bindUIEvents() {
  const { socket } = S;

  $('btn-create-room').addEventListener('click', () => {
    const nickname = inputNickname.value.trim();
    if (!nickname) { toast('Enter a nickname.', true); return; }
    socket.emit('create_room', { nickname }, res => {
      if (!res.success) { toast(res.error, true); return; }
      handleJoinSuccess(res, nickname);
    });
  });

  $('btn-join-room').addEventListener('click', () => {
    const nickname = inputNickname.value.trim();
    const roomCode = inputRoomCode.value.trim().toUpperCase();
    if (!nickname) { toast('Enter a nickname.', true); return; }
    if (!roomCode) { toast('Enter a room code.', true); return; }
    socket.emit('join_room', { roomCode, nickname }, res => {
      if (!res.success) { toast(res.error, true); return; }
      handleJoinSuccess(res, nickname);
    });
  });

  $('btn-copy-code').addEventListener('click', copyRoomLink);
  $('btn-copy-link').addEventListener('click', copyRoomLink);

  // Rules (host only — emitted on any change)
  const emitRules = () => {
    if (!S.isHost) return;
    socket.emit('update_rules', {
      rules: {
        roundSequence:      ruleSequence.value,
        maxCardsCap:        parseInt(ruleMaxCards.value, 10),
        trumpSelection:     ruleTrump.value,
        scoringMode:        ruleScoring.value,
        biddingRestriction: ruleBiddingRestriction.checked
      }
    });
  };
  ruleSequence.addEventListener('change', emitRules);
  ruleMaxCards.addEventListener('change', emitRules);
  ruleTrump.addEventListener('change', emitRules);
  ruleScoring.addEventListener('change', emitRules);
  ruleBiddingRestriction.addEventListener('change', emitRules);

  btnStartGame.addEventListener('click', () => {
    if (!S.isHost) return;
    socket.emit('start_game', {}, res => {
      if (res && !res.success) toast(res.error, true);
    });
  });

  btnNextRound.addEventListener('click', () => {
    socket.emit('next_round', {}, res => {
      if (res && !res.success) { toast(res.error, true); return; }
      modalRoundSummary.classList.add('hidden');
    });
  });

  $('btn-play-again').addEventListener('click', () => {
    modalGameOver.classList.add('hidden');
    showScreen('lobby');
  });

  // Enter key on room code input triggers join
  inputRoomCode.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-join-room').click();
  });
  inputNickname.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (inputRoomCode.value.trim()) {
        $('btn-join-room').click();
      } else {
        $('btn-create-room').click();
      }
    }
  });
}

function handleJoinSuccess(res, nickname) {
  S.roomCode = res.roomCode;
  S.token    = res.token;
  S.playerId = res.playerId;
  S.nickname = nickname;
  localStorage.setItem('kachuful_token', res.token);
  localStorage.setItem('kachuful_room',  res.roomCode);
  localStorage.setItem('kachuful_nick',  nickname);
  updateHeaderRoom(res.roomCode);
  showScreen('lobby');
  renderLobby(res.lobbyState);
}

// ─── Lobby rendering ──────────────────────────────────────────────────────────
function renderLobby(state) {
  if (!state) return;
  lobbyRoomCode.textContent    = state.roomCode;
  lobbyPlayerCount.textContent = state.players.length;

  S.isHost = state.hostId === S.playerId;

  // Sync rules form (read-only for guests)
  const fields = formRules.querySelectorAll('input, select');
  fields.forEach(el => { el.disabled = !S.isHost; });
  if (state.rules) {
    ruleSequence.value             = state.rules.roundSequence  || 'up_down';
    ruleMaxCards.value             = state.rules.maxCardsCap    || 13;
    ruleTrump.value                = state.rules.trumpSelection || 'turn_up';
    ruleScoring.value              = state.rules.scoringMode    || 'standard';
    ruleBiddingRestriction.checked = !!state.rules.biddingRestriction;
  }

  // Player roster
  lobbyPlayerList.innerHTML = '';
  state.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = `roster-item${p.id === S.playerId ? ' is-me' : ''}`;
    const dot  = `<span class="status-dot ${p.connected ? 'status-online' : 'status-offline'}"></span>`;
    const host = p.isHost ? '<span class="badge-host">HOST</span>' : '';
    const me   = p.id === S.playerId ? ' (You)' : '';
    li.innerHTML = `<div style="display:flex;align-items:center">${dot}<span>${i+1}. <strong>${html(p.name)}</strong>${me}</span></div>${host}`;
    lobbyPlayerList.appendChild(li);
  });

  // Start button
  if (S.isHost) {
    const canStart = state.players.length >= 3;
    btnStartGame.disabled   = !canStart;
    btnStartGame.textContent = canStart
      ? `Start Game  (${state.players.length} players)`
      : `Need at least 3 players  (${state.players.length}/3)`;
  } else {
    btnStartGame.disabled    = true;
    btnStartGame.textContent = 'Waiting for host to start…';
  }
}

// ─── Game rendering ───────────────────────────────────────────────────────────
function renderGame(state) {
  const isMyTurn = state.currentTurn === S.playerId;

  // 1. HUD
  hudRound.textContent = `${state.roundNumber} / ${state.totalRounds}`;

  const trump = state.trumpSuit || 'NT';
  const isRedTrump = (trump === 'H' || trump === 'D');
  hudTrumpIcon.textContent = SUIT_SYMBOLS[trump] || trump;
  hudTrumpIcon.className   = isRedTrump ? 'suit-red' : 'suit-black';
  if (trump === 'NT') hudTrumpIcon.className = '';
  hudTrumpName.textContent = SUIT_NAMES[trump] || trump;

  const dealerPlayer = state.players.find(p => p.id === state.dealer);
  hudDealerName.textContent = dealerPlayer ? dealerPlayer.name : '—';

  const turnPlayer = state.players.find(p => p.id === state.currentTurn);
  hudCurrentTurn.textContent = isMyTurn
    ? 'Your Turn!'
    : (turnPlayer ? turnPlayer.name : '—');

  // 2. Opponents bar (everyone except self)
  opponentsBar.innerHTML = '';
  state.players.forEach(p => {
    if (p.id === S.playerId) return;
    const pill = document.createElement('div');
    const isTurn = state.currentTurn === p.id;
    pill.className = `opponent-pill${isTurn ? ' is-turn' : ''}`;

    const dot    = `<span class="status-dot ${p.connected ? 'status-online' : 'status-offline'}"></span>`;
    const bid    = p.bid !== null ? `bid ${p.bid}` : 'bidding…';
    const won    = `${p.tricksWon} won`;

    pill.innerHTML = `${dot}<strong>${html(p.name)}</strong> · ${bid} · ${won}`;
    opponentsBar.appendChild(pill);
  });

  // 3. Live scoreboard
  scoreboardBody.innerHTML = '';
  state.players.forEach(p => {
    const tr = document.createElement('tr');
    const isMe = p.id === S.playerId;
    tr.className = isMe ? 'is-me' : '';
    const bidStr = p.bid !== null ? p.bid : '—';
    const meStar = isMe ? ' ★' : '';
    tr.innerHTML = `
      <td>${html(p.name)}${meStar}</td>
      <td>${bidStr}</td>
      <td>${p.tricksWon}</td>
      <td>${p.totalScore}</td>`;
    scoreboardBody.appendChild(tr);
  });

  // 4. Trick area — show current trick OR last completed trick
  trickCardsContainer.innerHTML = '';
  const trickToShow = state.currentTrick.length > 0
    ? state.currentTrick
    : (state.lastCompletedTrick?.plays || []);

  trickToShow.forEach(play => {
    const pInfo = state.players.find(p => p.id === play.playerId);
    const wrap  = document.createElement('div');
    wrap.className = 'trick-card-wrap';
    const cardEl = makeCard(play.card);
    const lbl    = document.createElement('span');
    lbl.className   = 'trick-player-label';
    lbl.textContent = pInfo ? pInfo.name : play.playerId;
    wrap.appendChild(cardEl);
    wrap.appendChild(lbl);
    trickCardsContainer.appendChild(wrap);
  });

  // 5. Trick winner banner
  if (state.lastCompletedTrick && state.currentTrick.length === 0 && state.phase === 'PLAYING') {
    const winnerInfo = state.players.find(p => p.id === state.lastCompletedTrick.winner.playerId);
    trickWinnerText.textContent = winnerInfo
      ? `${winnerInfo.name} wins the trick!`
      : 'Trick complete!';
    trickWinnerBanner.classList.remove('hidden');
  } else {
    trickWinnerBanner.classList.add('hidden');
  }

  // 6. Bidding tray
  if (state.phase === 'BIDDING' && isMyTurn) {
    biddingTray.classList.remove('hidden');
    bidHint.textContent = `Round of ${state.cardsInRound} trick${state.cardsInRound !== 1 ? 's' : ''}. How many will you win?`;
    bidButtonsGrid.innerHTML = '';
    for (let b = 0; b <= state.cardsInRound; b++) {
      const btn     = document.createElement('button');
      btn.className = 'btn-bid';
      btn.textContent = b;
      const legal   = state.myLegalBids.includes(b);
      btn.disabled  = !legal;
      if (!legal) btn.title = 'Forbidden (dealer restriction)';
      if (legal) {
        btn.addEventListener('click', () => {
          S.socket.emit('place_bid', { bid: b }, res => {
            if (res && !res.success) toast(res.error, true);
          });
        });
      }
      bidButtonsGrid.appendChild(btn);
    }
  } else {
    biddingTray.classList.add('hidden');
  }

  // 7. Player's hand
  playerHandEl.innerHTML = '';
  handCardsCount.textContent = state.myHand.length;

  if (state.phase === 'BIDDING') {
    handInstruction.textContent = isMyTurn
      ? 'Bid above ↑'
      : `Waiting for ${turnPlayer ? turnPlayer.name : 'others'} to bid…`;
  } else if (state.phase === 'PLAYING') {
    handInstruction.textContent = isMyTurn ? 'Select a card to play' : '';
  } else {
    handInstruction.textContent = '';
  }

  state.myHand.forEach(card => {
    const cardEl  = makeCard(card);
    cardEl.classList.add('hand-card');

    const canPlay = isMyTurn
      && state.phase === 'PLAYING'
      && state.myLegalPlays.some(c => c.suit === card.suit && c.rank === card.rank);

    if (state.phase === 'PLAYING' && isMyTurn) {
      if (canPlay) {
        cardEl.classList.add('is-playable');
        cardEl.addEventListener('click', () => {
          S.socket.emit('play_card', { card }, res => {
            if (res && !res.success) toast(res.error, true);
          });
        });
      } else {
        cardEl.classList.add('not-playable');
      }
    }

    playerHandEl.appendChild(cardEl);
  });

  // 8. Round ended modal
  if (state.phase === 'ROUND_ENDED') {
    renderRoundSummary(state);
    modalRoundSummary.classList.remove('hidden');
  } else {
    modalRoundSummary.classList.add('hidden');
  }

  // 9. Game over modal
  if (state.phase === 'GAME_OVER') {
    renderGameOver(state);
    modalGameOver.classList.remove('hidden');
  } else {
    modalGameOver.classList.add('hidden');
  }
}

// ─── Round summary modal ──────────────────────────────────────────────────────
function renderRoundSummary(state) {
  const last = state.roundHistory[state.roundHistory.length - 1];
  if (!last) return;

  summaryRoundTitle.textContent = `Round ${state.roundNumber} of ${state.totalRounds} — Summary`;

  // Host controls next-round button; non-host sees disabled message
  const iAmHost = state.hostId === S.playerId;
  btnNextRound.disabled    = !iAmHost;
  btnNextRound.textContent = iAmHost ? 'Start Next Round →' : 'Waiting for host…';

  summaryTableBody.innerHTML = '';

  // Sort descending by total score for cleaner reading
  const sorted = [...state.players].sort((a, b) => {
    const ra = last.results[a.id];
    const rb = last.results[b.id];
    return (rb?.totalScore ?? 0) - (ra?.totalScore ?? 0);
  });

  sorted.forEach(p => {
    const r  = last.results[p.id] || { bid: 0, tricksWon: 0, pointsEarned: 0, totalScore: 0 };
    const hit = r.bid === r.tricksWon;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${html(p.name)}</strong>${p.id === S.playerId ? ' ★' : ''}</td>
      <td>${r.bid}</td>
      <td>${r.tricksWon}</td>
      <td style="color:${hit ? 'var(--primary)' : 'var(--danger)'}">
        ${hit ? '+' : ''}${r.pointsEarned}
      </td>
      <td><strong>${r.totalScore}</strong></td>`;
    summaryTableBody.appendChild(tr);
  });
}

// ─── Game over modal ──────────────────────────────────────────────────────────
function renderGameOver(state) {
  const sorted = [...state.players].sort((a, b) => b.totalScore - a.totalScore);
  if (sorted.length > 0) {
    gameOverWinner.textContent = `${sorted[0].name} wins with ${sorted[0].totalScore} points!`;
  }

  gameOverTableBody.innerHTML = '';
  sorted.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${i + 1}</td>
      <td><strong>${html(p.name)}</strong>${p.id === S.playerId ? ' ★' : ''}</td>
      <td>${p.totalScore}</td>`;
    gameOverTableBody.appendChild(tr);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
