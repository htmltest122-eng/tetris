// script.js — версия со звуком и сохранением имени/сложности
// Подходит к твоему HTML (ids: tetris, next, startBtn, pauseBtn, stopBtn, playerName, difficulty, score, status, scoresTable, resetScores)

///// Настройки и элементы UI
const canvas = document.getElementById('tetris');
const ctx = canvas.getContext('2d');
ctx.scale(20, 20);

const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');
nextCtx.scale(20, 20);

const scoreElem = document.getElementById('score');
const statusElem = document.getElementById('status');
const diffSelect = document.getElementById('difficulty');
const playerNameInput = document.getElementById('playerName');
const scoresTableBody = document.querySelector('#scoresTable tbody');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const resetScoresBtn = document.getElementById('resetScores');

///// Persistent keys
const STORAGE_KEY_SCORES = 'tetris_highscores_v2';
const STORAGE_KEY_SETTINGS = 'tetris_settings_v1';

///// Game state
let animationFrameId = null;
let isRunning = false;
let isPaused = false;

const colors = [
  null,
  '#FF0D72', '#0DC2FF', '#0DFF72', '#F538FF',
  '#FF8E0D', '#FFE138', '#3877FF'
];

const arena = createMatrix(12, 20);
let nextPiece = randomPiece();

const player = {
  pos: {x: 0, y: 0},
  matrix: null,
  score: 0,
};

const BASE_SPEEDS = [1000, 700, 450, 250];
let dropInterval = BASE_SPEEDS[1];
let dropCounter = 0;
let lastTime = 0;

///// Audio
let audioCtx = null;
let soundEnabled = true;

function ensureAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function resumeAudioContextIfNeeded() {
  if (audioCtx && audioCtx.state === 'suspended') return audioCtx.resume();
  return Promise.resolve();
}

function playClick() {
  if (!soundEnabled) return;
  ensureAudioContext();
  const t0 = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = 900;
  g.gain.value = 0;
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.12, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  o.start(t0);
  o.stop(t0 + 0.15);
}

function playPop() {
  if (!soundEnabled) return;
  ensureAudioContext();
  const t0 = audioCtx.currentTime;
  const bufferSize = 0.2 * audioCtx.sampleRate;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-5 * i / bufferSize);
  }
  const src = audioCtx.createBufferSource();
  const g = audioCtx.createGain();
  src.buffer = buffer;
  src.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  src.start(t0);
}

function playThud() {
  if (!soundEnabled) return;
  ensureAudioContext();
  const t0 = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sawtooth';
  o.frequency.value = 120;
  g.gain.value = 0;
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.3, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  o.start(t0);
  o.stop(t0 + 0.6);
}

///// Sound toggle
const panel = document.querySelector('.panel');
const soundToggleBtn = document.createElement('button');
soundToggleBtn.id = 'soundToggleBtn';
soundToggleBtn.style.marginLeft = '6px';
soundToggleBtn.style.marginTop = '8px';
panel.appendChild(soundToggleBtn);
soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  updateSoundButton();
  saveSettings();
});
function updateSoundButton() {
  soundToggleBtn.textContent = soundEnabled ? 'Звук: Вкл' : 'Звук: Выкл';
}

///// Settings
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY_SETTINGS) || '{}');
    if (s.name) playerNameInput.value = s.name;
    if (typeof s.difficulty !== 'undefined') {
      diffSelect.value = String(s.difficulty);
      dropInterval = BASE_SPEEDS[Number(s.difficulty)];
    }
    if (typeof s.soundEnabled !== 'undefined') soundEnabled = !!s.soundEnabled;
  } catch {}
  updateSoundButton();
}
function saveSettings() {
  const s = {
    name: playerNameInput.value || '',
    difficulty: Number(diffSelect.value),
    soundEnabled: !!soundEnabled
  };
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(s));
}

// Ваши настройки из Firebase (Config)
 const firebaseConfig = {
    apiKey: "AIzaSyCJhN9KOp69QVmNeNJx-ODqTGAzbrukVsM",
    authDomain: "tetris-b2119.firebaseapp.com",
    databaseURL: "https://tetris-b2119-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "tetris-b2119",
    storageBucket: "tetris-b2119.firebasestorage.app",
    messagingSenderId: "497676585923",
    appId: "1:497676585923:web:9d08173b3712016876cb76"
  };

// Инициализация Firebase
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database(); // подключаемся к Realtime Database

///// ONLINE LEADERBOARD через Firebase
function saveScore(name, scoreVal) {
  if (!name) name = 'Игрок';
  const scoresRef = database.ref('scores');
  scoresRef.push({
    name,
    score: Number(scoreVal) || 0,
    date: Date.now()
  });
  updateHighscoresTable();
}

// Загрузить и показать топ-10 рекордов из Firebase
function updateHighscoresTable() {
  const scoresRef = database.ref('scores');
  scoresRef.orderByChild('score').limitToLast(10).once('value', snapshot => {
    const scores = [];
    snapshot.forEach(child => scores.push(child.val()));
    scores.sort((a, b) => b.score - a.score);

    scoresTableBody.innerHTML = '';
    scores.forEach((item, i) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${i + 1}</td><td>${item.name}</td><td>${item.score}</td>`;
      scoresTableBody.appendChild(row);
    });
  });
}

// Функция для загрузки рекордов
function loadScores(callback) {
  const scoresRef = database.ref('scores');
  scoresRef.orderByChild('score').limitToLast(10).on('value', snapshot => {
    const scores = [];
    snapshot.forEach(child => {
      scores.push(child.val());
    });
    // Сортировка по убыванию очков
    scores.sort((a, b) => b.score - a.score);
    callback(scores);
  });
}

resetScoresBtn.addEventListener('click', () => {
  if (confirm('Сбросить рекорды?')) {
    localStorage.removeItem(STORAGE_KEY_SCORES);
    updateHighscoresTable();
  }
});

///// Matrix / pieces / draw
function createMatrix(w, h) {
  const matrix = [];
  while (h--) matrix.push(new Array(w).fill(0));
  return matrix;
}
function createPiece(type) {
  if (type === 'T') return [[0,1,0],[1,1,1],[0,0,0]];
  if (type === 'O') return [[2,2],[2,2]];
  if (type === 'L') return [[0,0,3],[3,3,3],[0,0,0]];
  if (type === 'J') return [[4,0,0],[4,4,4],[0,0,0]];
  if (type === 'I') return [[0,0,0,0],[5,5,5,5],[0,0,0,0],[0,0,0,0]];
  if (type === 'S') return [[0,6,6],[6,6,0],[0,0,0]];
  if (type === 'Z') return [[7,7,0],[0,7,7],[0,0,0]];
}
function randomPiece() {
  const pieces = 'TJLOSZI';
  return createPiece(pieces[Math.floor(Math.random() * pieces.length)]);
}

function drawMatrix(matrix, offset, context, outline = true) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        context.fillStyle = colors[value];
        context.fillRect(x + offset.x, y + offset.y, 1, 1);
        if (outline) {
          context.strokeStyle = '#00ff66';
          context.lineWidth = 0.05;
          context.strokeRect(x + offset.x, y + offset.y, 1, 1);
        }
      }
    });
  });
}
function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMatrix(arena, {x:0, y:0}, ctx);
  if (player.matrix) drawMatrix(player.matrix, player.pos, ctx);
}
function drawNext() {
  nextCtx.fillStyle = '#000';
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  const offset = {
    x: Math.floor((6 - nextPiece[0].length) / 2),
    y: Math.floor((6 - nextPiece.length) / 2)
  };
  drawMatrix(nextPiece, offset, nextCtx);
}

///// Merge / collide / sweep
function merge(arena, player) {
  player.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) arena[y + player.pos.y][x + player.pos.x] = value;
    });
  });
}
function collide(arena, player) {
  const [m, o] = [player.matrix, player.pos];
  for (let y = 0; y < m.length; ++y) {
    for (let x = 0; x < m[y].length; ++x) {
      if (m[y][x] !== 0 &&
          (arena[y + o.y] &&
           arena[y + o.y][x + o.x]) !== 0) {
        return true;
      }
    }
  }
  return false;
}
function arenaSweep() {
  let linesRemoved = 0;
  outer: for (let y = arena.length - 1; y > 0; --y) {
    for (let x = 0; x < arena[y].length; ++x) {
      if (arena[y][x] === 0) continue outer;
    }
    const row = arena.splice(y, 1)[0].fill(0);
    arena.unshift(row);
    ++y;
    linesRemoved++;
    player.score += 10;
    updateScore();
  }
  if (linesRemoved) playPop();
}

///// Player control
async function playerDrop() {
  player.pos.y++;
  if (collide(arena, player)) {
    player.pos.y--;
    merge(arena, player);
    arenaSweep();
    await playerReset(); // теперь ждём окончания записи рекорда
    playClick();
  }
  dropCounter = 0;
}

function playerMove(dir) {
  player.pos.x += dir;
  if (collide(arena, player)) player.pos.x -= dir;
  else playClick();
}
function playerRotate(dir) {
  const pos = player.pos.x;
  let offset = 1;
  rotate(player.matrix, dir);
  while (collide(arena, player)) {
    player.pos.x += offset;
    offset = -(offset + (offset > 0 ? 1 : -1));
    if (offset > player.matrix[0].length) {
      rotate(player.matrix, -dir);
      player.pos.x = pos;
      return;
    }
  }
  playClick();
}
function rotate(matrix, dir) {
  for (let y = 0; y < matrix.length; ++y) {
    for (let x = 0; x < y; ++x) {
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
  }
  if (dir > 0) matrix.forEach(row => row.reverse());
  else matrix.reverse();
}
async function playerReset() {
  player.matrix = nextPiece;
  nextPiece = randomPiece();
  drawNext();
  player.pos.y = 0;
  player.pos.x = Math.floor((arena[0].length - player.matrix[0].length) / 2);

  if (collide(arena, player)) {
    playThud();

    // Сохраняем рекорд и ждём ответа
    await saveScore(playerNameInput.value || 'Игрок', player.score);

    arena.forEach(row => row.fill(0));
    player.score = 0;
    updateScore();
    isRunning = false;
    statusElem.textContent = 'Проигрыш';
    cancelAnimationFrame(animationFrameId);
  }
}

function updateScore() { scoreElem.textContent = player.score; }

///// Game loop
function update(time = 0) {
  if (!isRunning || isPaused) return;
  const deltaTime = time - lastTime;
  lastTime = time;
  dropCounter += deltaTime;
  if (dropCounter > dropInterval) playerDrop();
  draw();
  animationFrameId = requestAnimationFrame(update);
}

///// Input handling
document.addEventListener('keydown', e => {
  if (!isRunning || isPaused) return;
  if (e.key === 'ArrowLeft') playerMove(-1);
  else if (e.key === 'ArrowRight') playerMove(1);
  else if (e.key === 'ArrowDown') playerDrop();
  else if (e.key === 'ArrowUp') playerRotate(1);
});

///// Buttons
startBtn.addEventListener('click', async () => {
  ensureAudioContext();
  await resumeAudioContextIfNeeded();
  saveSettings();
  if (!isRunning) {
    isRunning = true;
    isPaused = false;
    statusElem.textContent = 'Игра идёт';
    arena.forEach(row => row.fill(0));
    player.score = 0;
    updateScore();
    if (!player.matrix) playerReset();
    dropInterval = BASE_SPEEDS[Number(diffSelect.value)];
    lastTime = performance.now();
    updateHighscoresTable();
    update();
  } else if (isPaused) {
    isPaused = false;
    statusElem.textContent = 'Игра идёт';
    lastTime = performance.now();
    update();
  }
});

pauseBtn.addEventListener('click', () => {
  if (!isRunning) return;
  isPaused = !isPaused;
  if (isPaused) {
    statusElem.textContent = 'Пауза';
    cancelAnimationFrame(animationFrameId);
  } else {
    statusElem.textContent = 'Игра идёт';
    lastTime = performance.now();
    update();
  }
});

stopBtn.addEventListener('click', () => {
  isRunning = false;
  isPaused = false;
  statusElem.textContent = 'Остановлена';
  cancelAnimationFrame(animationFrameId);
  arena.forEach(row => row.fill(0));
  player.score = 0;
  updateScore();
  draw();
});

diffSelect.addEventListener('change', () => {
  dropInterval = BASE_SPEEDS[Number(diffSelect.value)];
  saveSettings();
});
playerNameInput.addEventListener('input', saveSettings);

///// Initialization
function initAll() {
  loadSettings();
  updateHighscoresTable();
  draw();
  drawNext();
  dropInterval = BASE_SPEEDS[Number(diffSelect.value)];
  statusElem.textContent = 'Ожидание';
  updateSoundButton();
}
initAll();

// end of file
