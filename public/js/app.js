/**
 * Kachuful / Judgement Online — Client App
 * Inspired by the top-rated Judgement mobile game:
 * - Oval card table with seated player avatars & trick counters
 * - Centered round, trump & turn pot indicator
 * - Smooth trick play animations & winner announcements
 * - Clean modal scorecard with full round breakdown
 * - Built-in session persistence & instant invite links
 */

const SUIT_SYMBOLS = { S: '♠', H: '♥', C: '♣', D: '♦', NT: 'NT' };
const SUIT_NAMES   = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds', NT: 'No Trump' };
const RANK_LABELS  = {
  2:'2', 3:'3', 4:'4', 5:'5', 6:'6', 7:'7', 8:'8', 9:'9', 10:'10',
  11:'J', 12:'Q', 13:'K', 14:'A'
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

// ─── DOM Elements ─────────────────────────────────────────────────────────────
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
const headerRoomPill   = $('header-room-pill');
const headerRoomCode   = $('header-room-code');
const btnToggleScore   = $('btn-toggle-score');
const btnExitGame      = $('btn-exit-game');

// Lobby
const lobbyRoomCode    = $('lobby-room-code');
const lobbyPlayerCount = $('lobby-player-count');
const lobbyPlayerList  = $('lobby-player-list');
const btnStartGame     = $('btn-start-game');
const btnAddBot        = $('btn-add-bot');
const formRules        = $('form-rules');
const ruleMaxCards     = $('rule-max-cards');
const ruleTrump        = $('rule-trump');
const ruleBiddingRestriction = $('rule-bidding-restriction');

// Table Arena
const tableOpponents      = $('table-opponents');
const hudRound            = $('hud-round-number');
const hudTrumpIcon        = $('hud-trump-suit-icon');
const hudTrumpName        = $('hud-trump-name');
const hudCurrentTurn      = $('hud-current-turn');
const trickCardsContainer = $('trick-cards-container');
const trickWinnerBanner   = $('trick-winner-banner');
const trickWinnerText     = $('trick-winner-text');
const biddingTray         = $('bidding-tray');
const bidHint             = $('bidding-hint');
const bidButtonsGrid      = $('bid-buttons-grid');
const biddingTrumpIcon    = $('bidding-trump-icon');
const biddingTrumpText    = $('bidding-trump-text');
const biddingTrumpCardPreview = $('bidding-trump-card-preview');

// Hand
const playerHandEl   = $('player-hand');
const handCardsCount = $('hand-cards-count');
const handInstruction = $('hand-instruction');
const btnQuickScore  = $('btn-quick-score');

// Modals
const modalScorecard     = $('modal-scorecard');
const btnCloseScorecard  = $('btn-close-scorecard');
const scoreboardBody     = $('scoreboard-body');
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

  if (key === 'game') {
    btnToggleScore.classList.remove('hidden');
    btnExitGame.classList.remove('hidden');
  } else if (key === 'lobby') {
    btnToggleScore.classList.add('hidden');
    btnExitGame.classList.remove('hidden');
  } else {
    btnToggleScore.classList.add('hidden');
    btnExitGame.classList.add('hidden');
  }
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
    .catch(() => toast(url));
}

// ─── Card Rendering ───────────────────────────────────────────────────────────
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

// ─── Socket Initialization ────────────────────────────────────────────────────
function init() {
  S.socket = io();

  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) inputRoomCode.value = urlCode.toUpperCase();

  const savedNick = localStorage.getItem('kachuful_nick');
  if (savedNick) inputNickname.value = savedNick;

  const savedToken = localStorage.getItem('kachuful_token');
  const savedRoom  = localStorage.getItem('kachuful_room');
  if (savedToken && savedRoom) {
    S.socket.emit('reconnect_session', { roomCode: savedRoom, token: savedToken }, res => {
      if (res?.success) {
        S.roomCode = savedRoom;
        S.token    = savedToken;
        S.playerId = res.playerId;
        S.nickname = res.nickname || savedNick;
        updateHeaderRoom(savedRoom);

        if (res.phase === 'LOBBY') {
          showScreen('lobby');
          renderLobby(res.lobbyState);
        } else if (res.gameState) {
          S.gameState = res.gameState;
          showScreen('game');
          renderGame(res.gameState);
        }
      } else {
        localStorage.removeItem('kachuful_token');
        localStorage.removeItem('kachuful_room');
      }
    });
  }

  bindSocketEvents();
  bindUIEvents();
}

// ─── Socket Events ────────────────────────────────────────────────────────────
function bindSocketEvents() {
  const { socket } = S;

  socket.on('lobby_update', state => {
    if (!state.isGameStarted) {
      showScreen('lobby');
      renderLobby(state);
    }
  });

  socket.on('state_update', gameState => {
    S.gameState = gameState;
    if (gameState.phase !== 'NOT_STARTED') {
      showScreen('game');
      renderGame(gameState);
    }
  });

  socket.on('player_joined', ({ nickname }) => {
    toast(`${nickname} joined the table`);
  });

  socket.on('player_left', ({ nickname, reason }) => {
    toast(`${nickname} left (${reason})`, true);
  });

  socket.on('game_started', gameState => {
    S.gameState = gameState;
    showScreen('game');
    renderGame(gameState);
  });

  socket.on('game_state_update', gameState => {
    S.gameState = gameState;
    renderGame(gameState);
  });

  socket.on('trick_completed', ({ winner, trick }) => {
    if (S.gameState) {
      renderGame(S.gameState);
    }
  });

  socket.on('round_started', gameState => {
    S.gameState = gameState;
    modalRoundSummary.classList.add('hidden');
    renderGame(gameState);
    toast(`Round ${gameState.roundNumber} started!`);
  });

  socket.on('game_over', gameState => {
    S.gameState = gameState;
    showScreen('game');
    renderGame(gameState);
  });
}

// ─── UI Event Bindings ────────────────────────────────────────────────────────
function bindUIEvents() {
  const { socket } = S;

  $('btn-create-room').addEventListener('click', () => {
    const nickname = inputNickname.value.trim();
    if (!nickname) { toast('Enter your player name.', true); return; }
    socket.emit('create_room', { nickname }, res => {
      if (!res.success) { toast(res.error, true); return; }
      handleJoinSuccess(res, nickname);
    });
  });

  // Play with bots: create room and automatically add 3 bots
  $('btn-play-bots').addEventListener('click', () => {
    const nickname = inputNickname.value.trim() || 'Player';
    socket.emit('create_room', { nickname }, res => {
      if (!res.success) { toast(res.error, true); return; }
      handleJoinSuccess(res, nickname);
      // Auto-add 3 bots sequentially
      socket.emit('add_bot', {}, res1 => {
        if (!res1?.success) return;
        socket.emit('add_bot', {}, res2 => {
          if (!res2?.success) return;
          socket.emit('add_bot', {});
        });
      });
    });
  });

  // Add Bot button inside lobby
  if (btnAddBot) {
    btnAddBot.addEventListener('click', () => {
      if (!S.isHost) return;
      socket.emit('add_bot', {}, res => {
        if (res && !res.success) toast(res.error, true);
      });
    });
  }

  $('btn-join-room').addEventListener('click', () => {
    const nickname = inputNickname.value.trim();
    const roomCode = inputRoomCode.value.trim().toUpperCase();
    if (!nickname) { toast('Enter your player name.', true); return; }
    if (!roomCode) { toast('Enter a room code.', true); return; }
    socket.emit('join_room', { roomCode, nickname }, res => {
      if (!res.success) { toast(res.error, true); return; }
      handleJoinSuccess(res, nickname);
    });
  });

  $('btn-copy-code').addEventListener('click', copyRoomLink);
  $('btn-copy-link').addEventListener('click', copyRoomLink);

  // Scorecard toggle buttons
  const toggleScorecard = () => {
    modalScorecard.classList.toggle('hidden');
  };
  btnToggleScore.addEventListener('click', toggleScorecard);
  btnQuickScore.addEventListener('click', toggleScorecard);
  btnCloseScorecard.addEventListener('click', () => modalScorecard.classList.add('hidden'));

  // Exit Game button — leaves room and returns to home screen
  btnExitGame.addEventListener('click', () => {
    const confirmExit = confirm('Are you sure you want to leave this game and return to home?');
    if (!confirmExit) return;

    // Disconnect and reset session
    if (S.socket) {
      S.socket.disconnect();
    }
    localStorage.removeItem('kachuful_token');
    localStorage.removeItem('kachuful_room');
    S.roomCode = null;
    S.token = null;
    S.playerId = null;
    S.gameState = null;
    updateHeaderRoom(null);

    // Close any open modals
    modalScorecard.classList.add('hidden');
    modalRoundSummary.classList.add('hidden');
    modalGameOver.classList.add('hidden');

    // Return to home screen
    showScreen('home');
    toast('You left the game.');

    // Reconnect a fresh socket for next game
    S.socket = io();
    bindSocketEvents();
  });

  // Host rule updates
  const emitRules = () => {
    if (!S.isHost) return;
    socket.emit('update_rules', {
      rules: {
        roundSequence:      'up_down',
        maxCardsCap:        parseInt(ruleMaxCards.value, 10),
        trumpSelection:     ruleTrump.value,
        scoringMode:        'standard',
        biddingRestriction: ruleBiddingRestriction.checked
      }
    });
  };
  ruleMaxCards.addEventListener('change', emitRules);
  ruleTrump.addEventListener('change', emitRules);
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

  // Enter key support
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

// ─── Lobby Rendering ──────────────────────────────────────────────────────────
function renderLobby(state) {
  if (!state) return;
  lobbyRoomCode.textContent    = state.roomCode;
  lobbyPlayerCount.textContent = state.players.length;

  S.isHost = state.hostId === S.playerId;

  const fields = formRules.querySelectorAll('input, select');
  fields.forEach(el => { el.disabled = !S.isHost; });
  if (btnAddBot) {
    btnAddBot.style.display = S.isHost ? 'inline-flex' : 'none';
  }
  if (state.rules) {
    ruleMaxCards.value             = String(state.rules.maxCardsCap || 8);
    ruleTrump.value                = state.rules.trumpSelection || 'rotation';
    ruleBiddingRestriction.checked = !!state.rules.biddingRestriction;
  }

  lobbyPlayerList.innerHTML = '';
  state.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = `roster-item${p.id === S.playerId ? ' is-me' : ''}`;
    const dot  = `<span class="status-dot ${p.connected ? 'status-online' : 'status-offline'}"></span>`;
    const host = p.isHost ? '<span class="badge-host">HOST</span>' : '';
    const botBadge = p.isBot ? '<span class="badge-bot">BOT</span>' : '';
    const me   = p.id === S.playerId ? ' (You)' : '';
    const kickBtn = (S.isHost && p.isBot) ? `<button class="btn-remove-bot" data-bot-id="${p.id}" title="Remove Bot">×</button>` : '';

    li.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        ${dot}
        <span>${i+1}. <strong>${html(p.name)}</strong>${me}</span>
        ${botBadge}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        ${host}
        ${kickBtn}
      </div>
    `;

    if (kickBtn) {
      const removeBtn = li.querySelector('.btn-remove-bot');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('remove_bot', { botId: p.id }, res => {
            if (res && !res.success) toast(res.error, true);
          });
        });
      }
    }

    lobbyPlayerList.appendChild(li);
  });

  if (S.isHost) {
    const canStart = state.players.length >= 3;
    btnStartGame.disabled   = !canStart;
    btnStartGame.textContent = canStart
      ? `Start Game (${state.players.length} players)`
      : `Need at least 3 players (${state.players.length}/3)`;
    if (btnAddBot) {
      btnAddBot.disabled = state.players.length >= (state.rules?.maxPlayers || 8);
    }
  } else {
    btnStartGame.disabled    = true;
    btnStartGame.textContent = 'Waiting for host to start…';
  }
}

// ─── Game Rendering (Judgement Android Table Style) ───────────────────────────
function renderGame(state) {
  const isMyTurn = state.currentTurn === S.playerId;

  // 1. Center Pot HUD (Round / Trump / Turn)
  hudRound.textContent = `R ${state.roundNumber}/${state.totalRounds}`;

  const trump = state.trumpSuit || 'NT';
  const isRedTrump = (trump === 'H' || trump === 'D');
  hudTrumpIcon.textContent = SUIT_SYMBOLS[trump] || trump;
  hudTrumpIcon.className   = `pot-trump-icon ${isRedTrump ? 'suit-red' : 'suit-black'}`;
  if (trump === 'NT') hudTrumpIcon.className = 'pot-trump-icon';
  hudTrumpName.textContent = SUIT_NAMES[trump] || trump;

  const turnPlayer = state.players.find(p => p.id === state.currentTurn);
  hudCurrentTurn.textContent = isMyTurn
    ? 'YOUR TURN'
    : (turnPlayer ? `${turnPlayer.name}'s Turn` : '—');
  hudCurrentTurn.style.color = isMyTurn ? '#4ade80' : '#fde047';

  // 2. Seated Opponents Layout (Radial positioning around table)
  renderOpponentsAroundTable(state);

  // 3. Live Scoreboard (modal table)
  scoreboardBody.innerHTML = '';
  state.players.forEach(p => {
    const tr = document.createElement('tr');
    const isMe = p.id === S.playerId;
    if (isMe) tr.style.fontWeight = '800';
    const bidStr = p.bid !== null ? p.bid : '—';
    const meStar = isMe ? ' (You)' : '';
    tr.innerHTML = `
      <td>${html(p.name)}${meStar}</td>
      <td>${bidStr}</td>
      <td>${p.tricksWon}</td>
      <td>${p.totalScore}</td>`;
    scoreboardBody.appendChild(tr);
  });

  // 4. Center Trick Stage
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

  // 5. Trick Winner Banner
  if (state.lastCompletedTrick && state.currentTrick.length === 0 && state.phase === 'PLAYING') {
    const winnerInfo = state.players.find(p => p.id === state.lastCompletedTrick.winner.playerId);
    trickWinnerText.textContent = winnerInfo
      ? `🏆 ${winnerInfo.name} takes the trick!`
      : 'Trick complete!';
    trickWinnerBanner.classList.remove('hidden');
  } else {
    trickWinnerBanner.classList.add('hidden');
  }

  // 6. Bidding Dialog / Tray
  if (state.phase === 'BIDDING' && isMyTurn) {
    biddingTray.classList.remove('hidden');

    // Display trump suit & card prominent in judgment dialog
    if (biddingTrumpIcon && biddingTrumpText) {
      const isRed = (trump === 'H' || trump === 'D');
      biddingTrumpIcon.textContent = SUIT_SYMBOLS[trump] || trump;
      biddingTrumpIcon.className = `bidding-trump-icon ${isRed ? 'suit-red' : 'suit-black'}`;
      biddingTrumpText.textContent = SUIT_NAMES[trump] || trump;

      if (state.trumpCard && biddingTrumpCardPreview) {
        biddingTrumpCardPreview.innerHTML = '';
        const previewCard = makeCard(state.trumpCard);
        biddingTrumpCardPreview.appendChild(previewCard);
        biddingTrumpCardPreview.classList.remove('hidden');
      } else if (biddingTrumpCardPreview) {
        biddingTrumpCardPreview.innerHTML = '';
        biddingTrumpCardPreview.classList.add('hidden');
      }
    }

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

  // 7. Player Hand (Cards Fan)
  playerHandEl.innerHTML = '';
  handCardsCount.textContent = state.myHand.length;

  const mePlayer = state.players.find(p => p.id === S.playerId);
  const myBidStr = mePlayer?.bid !== null ? mePlayer?.bid : '—';
  const myWon    = mePlayer?.tricksWon ?? 0;

  if (state.phase === 'BIDDING') {
    handInstruction.textContent = isMyTurn
      ? '🎯 Select your bid above'
      : `⏳ Waiting for ${turnPlayer ? turnPlayer.name : 'others'} to bid…`;
  } else if (state.phase === 'PLAYING') {
    handInstruction.textContent = isMyTurn
      ? `👉 Play a card (Won: ${myWon}/${myBidStr})`
      : `Bid: ${myBidStr} · Won: ${myWon}`;
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

  // 8. Round summary modal
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

// ─── Opponents Positioning Around Oval Table ──────────────────────────────────
function renderOpponentsAroundTable(state) {
  tableOpponents.innerHTML = '';

  // Order other players starting clockwise after self
  const myIdx = state.players.findIndex(p => p.id === S.playerId);
  if (myIdx === -1) return;

  const otherPlayers = [];
  const n = state.players.length;
  for (let i = 1; i < n; i++) {
    otherPlayers.push(state.players[(myIdx + i) % n]);
  }

  // Calculate coordinates along top/left/right of table
  otherPlayers.forEach((p, idx) => {
    const slot = document.createElement('div');
    const isTurn = state.currentTurn === p.id;
    slot.className = `player-slot${isTurn ? ' is-turn' : ''}`;

    const pos = getTableCoordinates(idx, otherPlayers.length);
    slot.style.left = `${pos.x}%`;
    slot.style.top  = `${pos.y}%`;

    const isDealer = state.dealer === p.id;
    const initial  = p.isBot ? '🤖' : (p.name || '?').charAt(0).toUpperCase();
    const bidLabel = p.bid !== null ? p.bid : '?';
    const wonLabel = p.tricksWon;

    slot.innerHTML = `
      <div class="player-slot-card">
        <div class="player-avatar-circle ${p.isBot ? 'avatar-bot' : ''}">
          ${initial}
          ${isDealer ? '<span class="dealer-token" title="Dealer">D</span>' : ''}
        </div>
        <div class="player-info-meta">
          <span class="player-name-text">${html(p.name)}${p.isBot ? ' 🤖' : ''}</span>
          <span class="player-stats-text">Bid:${bidLabel} · Won:${wonLabel}</span>
        </div>
      </div>
    `;
    tableOpponents.appendChild(slot);
  });
}

function getTableCoordinates(idx, total) {
  // Balanced perimeter distribution around top edge of oval table
  if (total === 1) {
    return { x: 50, y: 14 }; // Top center
  }
  if (total === 2) {
    return [
      { x: 20, y: 24 }, // Top-Left
      { x: 80, y: 24 }  // Top-Right
    ][idx];
  }
  if (total === 3) {
    return [
      { x: 16, y: 36 }, // Left
      { x: 50, y: 14 }, // Top
      { x: 84, y: 36 }  // Right
    ][idx];
  }
  if (total === 4) {
    return [
      { x: 14, y: 44 }, // Far Left
      { x: 34, y: 16 }, // Top Left
      { x: 66, y: 16 }, // Top Right
      { x: 86, y: 44 }  // Far Right
    ][idx];
  }
  // Up to 7 opponents distributed in a smooth arc:
  const angleStart = Math.PI * 0.9;
  const angleEnd   = Math.PI * 0.1;
  const t = idx / (total - 1);
  const angle = angleStart - t * (angleStart - angleEnd);
  const x = 50 - 36 * Math.cos(angle);
  const y = 38 - 25 * Math.sin(angle);
  return { x: Math.round(x), y: Math.round(y) };
}

// ─── Round Summary Modal ──────────────────────────────────────────────────────
function renderRoundSummary(state) {
  const last = state.roundHistory[state.roundHistory.length - 1];
  if (!last) return;

  summaryRoundTitle.textContent = `Round ${state.roundNumber} of ${state.totalRounds} — Summary`;

  const iAmHost = state.hostId === S.playerId;
  btnNextRound.disabled    = !iAmHost;
  btnNextRound.textContent = iAmHost ? 'Start Next Round →' : 'Waiting for host…';

  summaryTableBody.innerHTML = '';

  const sorted = [...state.players].sort((a, b) => {
    const ra = last.results[a.id];
    const rb = last.results[b.id];
    return (rb?.totalScore ?? 0) - (ra?.totalScore ?? 0);
  });

  sorted.forEach(p => {
    const r   = last.results[p.id] || { bid: 0, tricksWon: 0, pointsEarned: 0, totalScore: 0 };
    const hit = r.bid === r.tricksWon;
    const tr  = document.createElement('tr');
    const isMe = p.id === S.playerId;
    if (isMe) tr.style.fontWeight = '800';

    tr.innerHTML = `
      <td>${html(p.name)}${isMe ? ' ★' : ''}</td>
      <td>${r.bid}</td>
      <td>${r.tricksWon}</td>
      <td style="color:${hit ? '#16a34a' : '#dc2626'}; font-weight:700;">
        ${hit ? '+' : ''}${r.pointsEarned} ${hit ? '✓' : '✗'}
      </td>
      <td><strong>${r.totalScore}</strong></td>`;
    summaryTableBody.appendChild(tr);
  });
}

// ─── Game Over Modal ──────────────────────────────────────────────────────────
function renderGameOver(state) {
  const sorted = [...state.players].sort((a, b) => b.totalScore - a.totalScore);
  const winner = sorted[0];

  gameOverWinner.textContent = winner
    ? `🎉 ${winner.name} won with ${winner.totalScore} points!`
    : 'Game Complete!';

  gameOverTableBody.innerHTML = '';
  sorted.forEach((p, idx) => {
    const tr = document.createElement('tr');
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`;
    tr.innerHTML = `
      <td>${medal}</td>
      <td>${html(p.name)}${p.id === S.playerId ? ' (You)' : ''}</td>
      <td><strong>${p.totalScore} pts</strong></td>`;
    gameOverTableBody.appendChild(tr);
  });
}

// Start
window.addEventListener('DOMContentLoaded', init);
