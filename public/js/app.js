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
  gameState: null,
  renderedPlaysSet: new Set(),
  roundSummaryDelayTimer: null,
  trickWinnerTimer: null,
  isThrowingCard: false
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
const ruleBiddingRestriction = $('rule-bidding-restriction');

// Table Arena
const tableOpponents      = $('table-opponents');
const playerSelfBadge     = $('player-self-badge');
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
const guessPanel          = $('guess-panel');
const guessPanelNamesRow  = $('guess-panel-names-row');
const guessPanelBadgesRow = $('guess-panel-badges-row');

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

function copyFallback(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Invite link copied!');
  } catch (e) {
    prompt('Copy room link:', text);
  }
}

let serverNetworkInfo = null;

async function fetchNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      serverNetworkInfo = await res.json();
      updateLobbyInviteLinks();
    }
  } catch (_) {}
}

function updateLobbyInviteLinks() {
  const wifiTip = $('lobby-wifi-tip');
  const wifiUrl = $('lobby-wifi-url');
  if (wifiTip && wifiUrl && serverNetworkInfo?.localIp && serverNetworkInfo.localIp !== 'localhost') {
    wifiUrl.textContent = `${serverNetworkInfo.lanUrl}/?room=${S.roomCode || 'CODE'}`;
    wifiTip.classList.remove('hidden');
  }
}

function copyRoomLink(forceMobile = false) {
  if (!S.roomCode) return;
  const isLocalHost = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  let baseUrl = location.origin;

  if (forceMobile || (isLocalHost && serverNetworkInfo?.localIp && serverNetworkInfo.localIp !== 'localhost')) {
    baseUrl = serverNetworkInfo?.lanUrl || baseUrl;
  }

  const url = `${baseUrl}/?room=${S.roomCode}`;
  const isMobileShare = (baseUrl !== location.origin);

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(url)
      .then(() => toast(isMobileShare ? `📱 Phone/Wi-Fi link copied! (${serverNetworkInfo?.localIp || 'LAN'})` : 'Invite link copied!'))
      .catch(() => copyFallback(url));
  } else {
    copyFallback(url);
  }
}

function showStaticServerNotice() {
  if ($('server-offline-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'server-offline-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 999999;
    background: rgba(10, 15, 30, 0.94); backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center;
    padding: 20px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;
  overlay.innerHTML = `
    <div style="background: #1e293b; border: 2px solid #3b82f6; border-radius: 20px; padding: 32px 24px; max-width: 480px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); color: #f8fafc;">
      <div style="font-size: 3rem; margin-bottom: 12px;">♠️ ♥️ ♣️ ♦️</div>
      <h2 style="margin: 0 0 10px 0; font-size: 1.5rem; color: #fbbf24; font-weight: 800;">Start Kachuful Game Server</h2>
      <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 20px;">
        This page was opened via a static preview (like VS Code Live Preview) instead of the Node.js game server.
      </p>
      <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 14px; margin-bottom: 20px; text-align: left;">
        <div style="color: #64748b; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; margin-bottom: 4px;">Run in Terminal:</div>
        <code style="color: #38bdf8; font-family: monospace; font-size: 1.05rem; font-weight: bold;">npm start</code>
      </div>
      <p style="color: #cbd5e1; font-size: 0.85rem; margin-bottom: 24px;">
        After starting the server, click Reload to connect!
      </p>
      <button id="btn-reload-after-start" style="background: #3b82f6; color: white; border: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; font-size: 1rem; cursor: pointer;">
        Reload Table 🔄
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('btn-reload-after-start')?.addEventListener('click', () => location.reload());
}

function sanitizeRoomCode(val) {
  if (!val) return '';
  let str = String(val).trim();
  const match = str.match(/[?&]room=([A-Za-z0-9]+)/i);
  if (match) return match[1].toUpperCase();
  const pathMatch = str.match(/\/([A-Za-z0-9]{4,6})(?:[/?#]|$)/);
  if (pathMatch) return pathMatch[1].toUpperCase();
  return str.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
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
  if (typeof io === 'undefined') {
    showStaticServerNotice();
    return;
  }

  fetchNetworkInfo();

  S.socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 2000,
    timeout: 10000
  });

  // If opened directly as installed standalone PWA on mobile, lock orientation directly
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    if (window.screen && screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => {});
    }
  }

  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) {
    const cleanUrlCode = sanitizeRoomCode(urlCode);
    inputRoomCode.value = cleanUrlCode;

    const inviteBanner = $('invite-detected-banner');
    const invitePill = $('invite-code-pill');
    if (inviteBanner && invitePill) {
      invitePill.textContent = cleanUrlCode;
      inviteBanner.classList.remove('hidden');
    }

    // Highlight Join action as primary for invited friend
    const btnJoin = $('btn-join-room');
    const btnCreate = $('btn-create-room');
    if (btnJoin && btnCreate) {
      btnJoin.classList.remove('btn-secondary');
      btnJoin.classList.add('btn-primary');
      btnJoin.textContent = `Join ${cleanUrlCode} 🚀`;
      btnCreate.classList.remove('btn-primary');
      btnCreate.classList.add('btn-secondary');
    }

    // If joining a different room via link, clear stale saved room
    if (localStorage.getItem('kachuful_room') && localStorage.getItem('kachuful_room') !== cleanUrlCode) {
      localStorage.removeItem('kachuful_room');
      localStorage.removeItem('kachuful_token');
    }
  }

  const savedNick = localStorage.getItem('kachuful_nick');
  if (savedNick) inputNickname.value = savedNick;

  // Bind socket & UI events right away so no events are missed
  bindSocketEvents();
  bindUIEvents();

  // Attempt initial reconnection
  attemptSessionReconnect();
}

function attemptSessionReconnect() {
  const savedToken = S.token || localStorage.getItem('kachuful_token');
  const savedRoom  = S.roomCode || localStorage.getItem('kachuful_room');
  const savedNick  = localStorage.getItem('kachuful_nick');

  if (savedToken && savedRoom) {
    S.socket.emit('reconnect_session', { roomCode: savedRoom, token: savedToken }, res => {
      if (res?.success) {
        S.roomCode = savedRoom;
        S.token    = savedToken;
        S.playerId = res.playerId;
        S.nickname = res.nickname || savedNick || S.nickname;
        updateHeaderRoom(savedRoom);

        if (res.isGameStarted && res.gameState) {
          S.gameState = res.gameState;
          showScreen('game');
          renderGame(res.gameState);
        } else if (res.lobbyState) {
          showScreen('lobby');
          renderLobby(res.lobbyState);
        }
      } else {
        localStorage.removeItem('kachuful_token');
        localStorage.removeItem('kachuful_room');
        S.roomCode = null;
        S.token = null;
        S.gameState = null;
        updateHeaderRoom(null);
        showScreen('home');
        toast('Previous room expired or server restarted. Please host or join a new game.', true);
      }
    });
  }
}

// ─── Socket Events ────────────────────────────────────────────────────────────
function bindSocketEvents() {
  const { socket } = S;

  // Auto re-sync session on any reconnect without page reload
  socket.on('connect', () => {
    attemptSessionReconnect();
  });

  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') {
      toast('Disconnected from server. Reconnecting...', true);
    }
  });

  socket.on('connect_error', () => {
    // Socket connection error
  });

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

// ─── Mobile Orientation Lock & Fullscreen ────────────────────────────────────
async function tryLockLandscape() {
  // 1. If supported directly (e.g. standalone PWA on Android)
  try {
    if (window.screen && screen.orientation && typeof screen.orientation.lock === 'function') {
      await screen.orientation.lock('landscape');
      return true;
    }
  } catch (e) {
    // Requires fullscreen in mobile browser tabs
  }

  // 2. Request fullscreen first then lock orientation (standard for Chrome Android)
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
      await el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
      await el.msRequestFullscreen();
    }

    if (window.screen && screen.orientation && typeof screen.orientation.lock === 'function') {
      await screen.orientation.lock('landscape');
      return true;
    }
  } catch (e) {
    // Unsupported or permission blocked (e.g. Safari iOS)
  }
  return false;
}

// ─── UI Event Bindings ────────────────────────────────────────────────────────
function bindUIEvents() {
  // Force landscape action from mobile portrait prompt
  const btnForceLandscape = $('btn-force-landscape');
  if (btnForceLandscape) {
    btnForceLandscape.addEventListener('click', async () => {
      await tryLockLandscape();
    });
  }

  const rotatePrompt = $('rotate-prompt');
  if (rotatePrompt) {
    rotatePrompt.addEventListener('click', (e) => {
      if (e.target && e.target.id !== 'btn-force-landscape') {
        tryLockLandscape();
      }
    });
  }

  // Auto-attempt landscape lock when starting or joining game
  ['btn-create-room', 'btn-play-bots', 'btn-join-room', 'btn-start-game'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('click', () => {
        tryLockLandscape();
      });
    }
  });

  $('btn-create-room').addEventListener('click', () => {
    const nickname = inputNickname.value.trim();
    if (!nickname) { toast('Enter your player name.', true); return; }
    S.socket.emit('create_room', { nickname }, res => {
      if (!res.success) { toast(res.error, true); return; }
      handleJoinSuccess(res, nickname);
    });
  });

  // Play with bots: instant start without lag or manual lobby wait
  $('btn-play-bots').addEventListener('click', () => {
    const nickname = inputNickname.value.trim() || 'Player';
    const btn = $('btn-play-bots');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon-lead">⏳</span> Starting...';

    S.socket.emit('play_with_bots', { nickname }, res => {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon-lead">🤖</span> Play with Bots';
      if (!res?.success) {
        toast(res?.error || 'Failed to start game with bots', true);
        return;
      }
      handleJoinSuccess(res, nickname);
      if (res.gameState) {
        S.gameState = res.gameState;
        showScreen('game');
        renderGame(res.gameState);
      }
    });
  });

  // Add Bot button inside lobby
  if (btnAddBot) {
    btnAddBot.addEventListener('click', () => {
      if (!S.isHost) return;
      S.socket.emit('add_bot', { count: 1 }, res => {
        if (res?.success) {
          renderLobby(res.lobbyState);
        } else if (res && !res.success) {
          toast(res.error, true);
        }
      });
    });
  }

  // Sanitize room code on input and paste (handles full URLs and extra spaces automatically)
  inputRoomCode.addEventListener('input', () => {
    inputRoomCode.value = sanitizeRoomCode(inputRoomCode.value);
  });

  inputRoomCode.addEventListener('paste', () => {
    setTimeout(() => {
      inputRoomCode.value = sanitizeRoomCode(inputRoomCode.value);
    }, 0);
  });

  $('btn-join-room').addEventListener('click', () => {
    const nickname = inputNickname.value.trim();
    const roomCode = sanitizeRoomCode(inputRoomCode.value);
    inputRoomCode.value = roomCode;
    if (!nickname) { toast('Enter your player name.', true); return; }
    if (!roomCode) { toast('Enter a room code.', true); return; }

    const savedToken = (localStorage.getItem('kachuful_room') === roomCode)
      ? localStorage.getItem('kachuful_token')
      : null;

    S.socket.emit('join_room', { roomCode, nickname, token: savedToken }, res => {
      if (!res.success) { toast(res.error, true); return; }
      handleJoinSuccess(res, nickname);
      if (res.gameState) {
        S.gameState = res.gameState;
        showScreen('game');
        renderGame(res.gameState);
      }
    });
  });

  $('btn-copy-code').addEventListener('click', () => copyRoomLink(false));
  $('btn-copy-link').addEventListener('click', () => copyRoomLink(false));
  const btnCopyMobile = $('btn-copy-mobile-link');
  if (btnCopyMobile) {
    btnCopyMobile.addEventListener('click', () => copyRoomLink(true));
  }

  // Scorecard toggle buttons
  const toggleScorecard = () => {
    modalScorecard.classList.toggle('hidden');
  };
  btnToggleScore.addEventListener('click', toggleScorecard);
  btnQuickScore.addEventListener('click', toggleScorecard);
  btnCloseScorecard.addEventListener('click', () => modalScorecard.classList.add('hidden'));

  // Exit Game button — leaves room and returns to home screen cleanly without breaking socket
  btnExitGame.addEventListener('click', () => {
    const confirmExit = confirm('Are you sure you want to leave this game and return to home?');
    if (!confirmExit) return;

    if (S.socket) {
      S.socket.emit('leave_room');
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
  });

  // Host rule updates
  const emitRules = () => {
    if (!S.isHost) return;
    S.socket.emit('update_rules', {
      rules: {
        roundSequence:      'up_down',
        maxCardsCap:        parseInt(ruleMaxCards.value, 10),
        trumpSelection:     'rotation',
        scoringMode:        'standard',
        biddingRestriction: ruleBiddingRestriction.checked
      }
    });
  };
  ruleMaxCards.addEventListener('change', emitRules);
  ruleBiddingRestriction.addEventListener('change', emitRules);

  btnStartGame.addEventListener('click', () => {
    if (!S.isHost) return;
    S.socket.emit('start_game', {}, res => {
      if (res && !res.success) toast(res.error, true);
    });
  });

  btnNextRound.addEventListener('click', () => {
    S.socket.emit('next_round', {}, res => {
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

  if (res.isGameStarted && res.gameState) {
    S.gameState = res.gameState;
    showScreen('game');
    renderGame(res.gameState);
  } else {
    showScreen('lobby');
    renderLobby(res.lobbyState);
  }
}

// ─── Lobby Rendering ──────────────────────────────────────────────────────────
function renderLobby(state) {
  if (!state) return;
  lobbyRoomCode.textContent    = state.roomCode;
  lobbyPlayerCount.textContent = state.players.length;
  updateLobbyInviteLinks();

  S.isHost = state.hostId === S.playerId;

  const fields = formRules.querySelectorAll('input, select');
  fields.forEach(el => { el.disabled = !S.isHost; });
  if (btnAddBot) {
    btnAddBot.style.display = S.isHost ? 'inline-flex' : 'none';
  }
  if (state.rules) {
    ruleMaxCards.value             = String(state.rules.maxCardsCap || 8);
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
          e.preventDefault();
          e.stopPropagation();
          S.socket.emit('remove_bot', { botId: p.id }, res => {
            if (res?.success) {
              renderLobby(res.lobbyState);
            } else if (res && !res.success) {
              toast(res.error, true);
            }
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

  // 1. Bottom-Right Corner HUD (Round X/Y & TRUMP symbol)
  if (hudRound) hudRound.textContent = `Round: ${state.roundNumber}/${state.totalRounds}`;

  const trump = state.trumpSuit || 'NT';
  const isRedTrump = (trump === 'H' || trump === 'D');
  if (hudTrumpIcon) {
    hudTrumpIcon.textContent = SUIT_SYMBOLS[trump] || trump;
    hudTrumpIcon.className   = `hud-trump-icon ${isRedTrump ? 'suit-red' : 'suit-black'}`;
    if (trump === 'NT') hudTrumpIcon.className = 'hud-trump-icon';
  }
  if (hudTrumpName) hudTrumpName.textContent = SUIT_NAMES[trump] || trump;

  // Center status badge
  if (hudCurrentTurn) {
    if (state.phase === 'BIDDING') {
      hudCurrentTurn.textContent = isMyTurn ? 'Your Judgement' : 'Making Judgement';
      hudCurrentTurn.style.background = isMyTurn ? '#3ecb7f' : '#f59e0b';
    } else {
      hudCurrentTurn.textContent = isMyTurn ? 'Your Turn' : 'Round Active';
      hudCurrentTurn.style.background = isMyTurn ? '#3ecb7f' : 'rgba(62,203,127,0.4)';
    }
  }

  // 2. Seated Opponents Layout & Self Badge (Authentic Indian Judgement Circular Avatars)
  renderOpponentsAroundTable(state);
  renderSelfBadge(state);

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

  const arenaEl = $('table-arena') || trickCardsContainer;
  const arenaRect = arenaEl.getBoundingClientRect();
  const targetCenterX = arenaRect.left + arenaRect.width / 2;
  const targetCenterY = arenaRect.top + arenaRect.height * 0.60;

  // Clear animated keys on bidding phase
  if (state.phase === 'BIDDING') {
    S.renderedPlaysSet.clear();
  }

  let hasNewPlayInTrick = false;

  trickToShow.forEach((play, index) => {
    const pInfo = state.players.find(p => p.id === play.playerId);
    const wrap  = document.createElement('div');
    wrap.className = 'trick-card-wrap';

    // Link card to player ID for dynamic origin animation
    if (play.playerId) {
      wrap.setAttribute('data-player-id', play.playerId);
    }

    // First card played in trick has red highlight border (exact Indian Judgement UI feature)
    const isFirstCard = (index === 0);
    const cardEl = makeCard(play.card);
    if (isFirstCard) {
      cardEl.classList.add('first-lead-card');
    }

    const lbl = document.createElement('span');
    lbl.className   = 'trick-player-label';
    lbl.textContent = pInfo ? pInfo.name : play.playerId;
    wrap.appendChild(cardEl);
    wrap.appendChild(lbl);

    // Compute dynamic origin vector from player's avatar icon to board
    const playKey = `${state.roundNumber}_${play.playerId}_${play.card.suit}${play.card.rank}_${index}`;
    const isNewPlay = !S.renderedPlaysSet.has(playKey);
    if (isNewPlay) {
      hasNewPlayInTrick = true;
      S.renderedPlaysSet.add(playKey);
      wrap.classList.add('animating-entry');

      // Find player's avatar icon element
      const playerSlotEl = document.getElementById(`slot-${play.playerId}`);
      if (playerSlotEl) {
        const pRect = playerSlotEl.getBoundingClientRect();
        const pCenterX = pRect.left + pRect.width / 2;
        const pCenterY = pRect.top + pRect.height / 2;
        const deltaX = pCenterX - targetCenterX;
        const deltaY = pCenterY - targetCenterY;
        wrap.style.setProperty('--fly-x', `${Math.round(deltaX)}px`);
        wrap.style.setProperty('--fly-y', `${Math.round(deltaY)}px`);
      } else {
        wrap.style.setProperty('--fly-x', '0px');
        wrap.style.setProperty('--fly-y', '-80px');
      }
    }

    trickCardsContainer.appendChild(wrap);
  });

  // 5. Trick Winner Banner (Shown after trick completes during playing or round ended)
  if (S.trickWinnerTimer) {
    clearTimeout(S.trickWinnerTimer);
    S.trickWinnerTimer = null;
  }

  const isTrickComplete = !!(state.lastCompletedTrick && state.currentTrick.length === 0 && (state.phase === 'PLAYING' || state.phase === 'ROUND_ENDED' || state.phase === 'GAME_OVER'));

  if (isTrickComplete) {
    const winnerId = state.lastCompletedTrick.winner?.playerId;
    const winnerInfo = state.players.find(p => p.id === winnerId);
    trickWinnerText.textContent = winnerInfo
      ? `🏆 ${winnerInfo.name} takes the trick!`
      : 'Trick complete!';

    // Hide normal turn badge so it does not clutter or compete for vertical space
    if (hudCurrentTurn) hudCurrentTurn.classList.add('hidden');

    const displayWinner = () => {
      trickWinnerBanner.classList.remove('hidden');
      if (winnerId) {
        const winnerCardWrap = trickCardsContainer.querySelector(`[data-player-id="${winnerId}"]`);
        if (winnerCardWrap) {
          winnerCardWrap.classList.add('is-trick-winner');
        }
      }
    };

    if (hasNewPlayInTrick) {
      // Keep banner hidden for 700ms so last player's card finishes animating and is clearly seen
      trickWinnerBanner.classList.add('hidden');
      S.trickWinnerTimer = setTimeout(displayWinner, 700);
    } else {
      displayWinner();
    }
  } else {
    trickWinnerBanner.classList.add('hidden');
    if (hudCurrentTurn) hudCurrentTurn.classList.remove('hidden');
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

    // Show other players' already-declared guesses as a player/hands table
    const allOtherPlayers = state.players.filter(p => p.id !== S.playerId);
    const anyBidMade = allOtherPlayers.some(p => p.bid !== null);
    if (anyBidMade && guessPanelNamesRow && guessPanelBadgesRow) {
      // Clear previous cells (keep the first <th> cell)
      Array.from(guessPanelNamesRow.querySelectorAll('td')).forEach(td => td.remove());
      Array.from(guessPanelBadgesRow.querySelectorAll('td')).forEach(td => td.remove());

      // Append one <td> per other player in each row
      allOtherPlayers.forEach(p => {
        const nameTd = document.createElement('td');
        nameTd.textContent = p.name;
        guessPanelNamesRow.appendChild(nameTd);

        const bidTd = document.createElement('td');
        bidTd.textContent = p.bid !== null ? p.bid : '';
        guessPanelBadgesRow.appendChild(bidTd);
      });

      guessPanel.classList.remove('hidden');
    } else {
      guessPanel.classList.add('hidden');
    }

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
    if (guessPanel) guessPanel.classList.add('hidden');
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
          if (S.isThrowingCard) return;
          S.isThrowingCard = true;
          // Trigger smooth throw animation
          cardEl.classList.add('throwing');

          const safetyTimer = setTimeout(() => {
            cardEl.classList.remove('throwing');
            S.isThrowingCard = false;
          }, 1500);

          setTimeout(() => {
            S.socket.emit('play_card', { card }, res => {
              clearTimeout(safetyTimer);
              S.isThrowingCard = false;
              if (res && !res.success) {
                cardEl.classList.remove('throwing');
                toast(res.error, true);
              }
            });
          }, 160);
        });
      } else {
        cardEl.classList.add('not-playable');
      }
    }

    playerHandEl.appendChild(cardEl);
  });

  // 8. Round summary modal — show with a gentle delay so players see the last card played and trick winner
  if (state.phase === 'ROUND_ENDED') {
    if (S.roundSummaryDelayTimer) clearTimeout(S.roundSummaryDelayTimer);
    // Keep round summary modal hidden temporarily for 2.2 seconds while the final card and trick winner banner are displayed
    S.roundSummaryDelayTimer = setTimeout(() => {
      renderRoundSummary(state);
      modalRoundSummary.classList.remove('hidden');
    }, 2200);
  } else {
    if (S.roundSummaryDelayTimer) {
      clearTimeout(S.roundSummaryDelayTimer);
      S.roundSummaryDelayTimer = null;
    }
    modalRoundSummary.classList.add('hidden');
  }

  // 9. Game over modal — also allow players to see the final trick resolution
  if (state.phase === 'GAME_OVER') {
    setTimeout(() => {
      renderGameOver(state);
      modalGameOver.classList.remove('hidden');
    }, 2200);
  } else {
    modalGameOver.classList.add('hidden');
  }
}

// ─── Opponents Positioning Around Oval Table ──────────────────────────────────
const AVATAR_COLORS = [
  '#ea580c', // orange (like Chris)
  '#0d9488', // teal (like Sam)
  '#e11d48', // crimson/red (like Rajesh)
  '#8b5cf6', // purple
  '#0284c7', // light blue
  '#16a34a', // green
  '#d97706'  // amber
];

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
    const bidLabel = p.bid !== null ? p.bid : '?';
    const wonLabel = p.tricksWon;
    const scoreVal = p.totalScore ?? 0;
    const colorBg  = p.isBot ? '#7c3aed' : AVATAR_COLORS[(idx) % AVATAR_COLORS.length];

    // Status pill under icon: "Playing" when playing card, "Guessing" when making judgment
    let statusPill = '';
    if (isTurn) {
      if (state.phase === 'BIDDING') {
        statusPill = `<div class="avatar-turn-status status-guessing">Guessing</div>`;
      } else if (state.phase === 'PLAYING') {
        statusPill = `<div class="avatar-turn-status status-playing">Playing</div>`;
      }
    }

    // Assign slot ID so card animation can compute exact vector from this player's avatar
    slot.id = `slot-${p.id}`;

    // Format badge with:
    // 1. Head circle with Total Score badge
    // 2. Won/Bid pill (e.g. 0/0 or 1/5)
    // 3. Status indicator ("Playing" / "Guessing")
    // 4. Name below
    slot.innerHTML = `
      <div class="player-avatar-widget" style="--avatar-color: ${colorBg};">
        <div class="avatar-head-circle">
          <svg class="avatar-head-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="7" r="4"/>
            <path d="M5.5 21v-2a6.5 6.5 0 0 1 13 0v2"/>
          </svg>
          <div class="avatar-bid-strip">
            <span class="won-count">${wonLabel}</span>/<span class="bid-count">${bidLabel}</span>
          </div>
        </div>
        ${isDealer ? '<span class="dealer-token" title="Dealer">D</span>' : ''}
        ${statusPill}
        <div class="avatar-player-name">${html(p.name)}${p.isBot ? ' 🤖' : ''}</div>
      </div>
    `;

    // Admin kick interaction if host
    if (S.isHost && p.id !== S.playerId) {
      slot.style.cursor = 'pointer';
      slot.title = p.isBot ? 'Click to remove bot' : 'Click to kick player (Admin)';
      slot.addEventListener('click', () => {
        const confirmKick = confirm(`Remove ${p.name} from room?`);
        if (confirmKick) {
          if (p.isBot) {
            S.socket.emit('remove_bot', { botId: p.id }, res => {
              if (res && !res.success) toast(res.error, true);
            });
          }
        }
      });
    }

    tableOpponents.appendChild(slot);
  });
}

function renderSelfBadge(state) {
  if (!playerSelfBadge) return;
  const me = state.players.find(p => p.id === S.playerId);
  if (!me) {
    playerSelfBadge.innerHTML = '';
    return;
  }

  const isDealer = state.dealer === me.id;
  const isTurn   = state.currentTurn === me.id;
  const bidLabel = me.bid !== null ? me.bid : '?';
  const wonLabel = me.tricksWon;
  const scoreVal = me.totalScore ?? 0;

  let selfStatusPill = '';
  if (isTurn) {
    if (state.phase === 'BIDDING') {
      selfStatusPill = `<div class="avatar-turn-status status-guessing">Guessing</div>`;
    } else if (state.phase === 'PLAYING') {
      selfStatusPill = `<div class="avatar-turn-status status-playing">Playing</div>`;
    }
  }

  playerSelfBadge.id = `slot-${me.id}`;
  playerSelfBadge.className = `player-slot slot-self${isTurn ? ' is-turn' : ''}`;
  playerSelfBadge.innerHTML = `
    <div class="player-avatar-widget self-widget" style="--avatar-color: #607d8b;">
      <div class="avatar-head-circle">
        <svg class="avatar-head-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="7" r="4"/>
          <path d="M5.5 21v-2a6.5 6.5 0 0 1 13 0v2"/>
        </svg>
        <div class="avatar-bid-strip">
          <span class="won-count">${wonLabel}</span>/<span class="bid-count">${bidLabel}</span>
        </div>
      </div>
      ${isDealer ? '<span class="dealer-token" title="Dealer">D</span>' : ''}
      ${selfStatusPill}
      <div class="avatar-player-name">${html(me.name)}</div>
    </div>
  `;
}

function getTableCoordinates(idx, total) {
  // Balanced perimeter distribution around top edge of oval table
  if (total === 1) {
    return { x: 50, y: 13 }; // Top center
  }
  if (total === 2) {
    return [
      { x: 22, y: 18 }, // Top-Left
      { x: 78, y: 18 }  // Top-Right
    ][idx];
  }
  if (total === 3) {
    return [
      { x: 10, y: 24 }, // Top-Left (clear of Self at bottom-left)
      { x: 50, y: 12 }, // Top-Center (clear of trick cards and status badge)
      { x: 90, y: 24 }  // Top-Right (clear of HUD at bottom-right)
    ][idx];
  }
  if (total === 4) {
    return [
      { x: 9,  y: 28 }, // Far Left
      { x: 33, y: 13 }, // Top Left
      { x: 67, y: 13 }, // Top Right
      { x: 91, y: 28 }  // Far Right
    ][idx];
  }
  // Up to 7 opponents distributed in a smooth arc around the top:
  const angleStart = Math.PI * 0.92;
  const angleEnd   = Math.PI * 0.08;
  const t = idx / (total - 1);
  const angle = angleStart - t * (angleStart - angleEnd);
  const x = 50 - 41 * Math.cos(angle);
  const y = 30 - 18 * Math.sin(angle);
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
