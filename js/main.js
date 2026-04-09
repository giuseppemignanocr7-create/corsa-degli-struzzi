// =============================================
//  CORSA DEGLI STRUZZI - Main Game Loop
// =============================================

(function () {
  'use strict';

  const canvas = document.getElementById('raceCanvas');
  const ctx    = canvas.getContext('2d');

  // Resize canvas to fill window
  function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    if (typeof race !== 'undefined' && race) race.resize(canvas.width, canvas.height);
  }

  // Init systems
  initOstrichData();

  const particles = new ParticleSystem();
  const race      = new RaceEngine(canvas, particles);
  const ui        = new UIController();

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  ui.refreshOdds();

  // ─── GAME STATE MACHINE ─────────────────

  let gameState   = 'SELECT'; // SELECT | COUNTDOWN | RACING | PAUSED | RESULTS
  let rafId       = null;
  let userChoice  = null;

  // ─── HELPERS ────────────────────────────

  function resetToMenu() {
    voiceCommentary.stop();
    cancelAnimationFrame(rafId);
    gameState = 'SELECT';
    ui.selectedId = null;
    ui._photoFinishShown = false;
    particles.particles = [];
    initOstrichData();
    ui.refreshOdds();
    document.querySelectorAll('.ostrich-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('start-btn').classList.remove('visible');
    document.getElementById('screen-results').classList.add('hidden');
    document.getElementById('screen-pause').classList.add('hidden');
    document.getElementById('screen-select').classList.remove('hidden');
    document.getElementById('screen-hud').classList.add('hidden');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ─── SELECTION → COUNTDOWN ──────────────

  document.getElementById('start-btn').addEventListener('click', () => {
    if (!ui.selectedId) return;
    userChoice = ui.selectedId;
    race.init(userChoice);
    gameState = 'COUNTDOWN';
    ui.showCountdown(() => {
      gameState = 'RACING';
      race.start();
      ui.showHud();
      voiceCommentary.sayStart(race.ostriches);
      rafId = requestAnimationFrame(gameLoop);
    });
  });

  // ─── PAUSE / RESUME ─────────────────────

  function pauseGame() {
    if (gameState !== 'RACING') return;
    gameState = 'PAUSED';
    race.running = false;
    cancelAnimationFrame(rafId);
    voiceCommentary.pause();
    document.getElementById('screen-pause').classList.remove('hidden');
  }

  function resumeGame() {
    if (gameState !== 'PAUSED') return;
    document.getElementById('screen-pause').classList.add('hidden');
    gameState = 'RACING';
    race.running  = true;
    race.lastTime = performance.now();
    voiceCommentary.resume();
    rafId = requestAnimationFrame(gameLoop);
  }

  document.getElementById('hud-pause-btn').addEventListener('click', pauseGame);
  document.getElementById('pause-resume-btn').addEventListener('click', resumeGame);
  document.getElementById('pause-restart-btn').addEventListener('click', () => {
    document.getElementById('screen-pause').classList.add('hidden');
    resetToMenu();
  });
  document.getElementById('pause-quit-btn').addEventListener('click', () => {
    document.getElementById('screen-pause').classList.add('hidden');
    resetToMenu();
  });

  // ESC key toggles pause
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (gameState === 'RACING') pauseGame();
      else if (gameState === 'PAUSED') resumeGame();
    }
  });

  // ─── MOBILE TOUCH CONTROLS ───────────────
  // Tap canvas = trigger mini burst on player ostrich
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (gameState === 'RACING' && userChoice && race) {
      const player = race.getOstrichById(userChoice);
      if (player && !player.finished) {
        // Force a short burst
        player.burstTimer = 600 + Math.random() * 400;
        player.burstSpeed = CONFIG.BURST_MAGNITUDE * 0.55;
        player.isBursting = true;
      }
    } else if (gameState === 'PAUSED') {
      resumeGame();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => { e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); }, { passive: false });

  // ─── MAIN GAME LOOP ──────────────────────

  function gameLoop(timestamp) {
    if (gameState !== 'RACING') return;

    const info = race.tick(timestamp);
    ui.updateHud(info, userChoice);

    if (info.finished) {
      gameState = 'RESULTS';
      const winner = race.finishOrder[0];
      if (winner) {
        const winnerOstrich = OSTRICH_DATA.find(o => o.id === winner.id);
        if (winnerOstrich) voiceCommentary.sayWinner(winnerOstrich);
      }
      setTimeout(() => {
        ui.showResults(race.finishOrder, userChoice, particles, canvas);
        rafId = requestAnimationFrame(confettiLoop);
      }, 600);
      return;
    }

    rafId = requestAnimationFrame(gameLoop);
  }

  // Post-race confetti render loop
  function confettiLoop(timestamp) {
    if (gameState !== 'RESULTS') return;
    race._render(1);
    particles.update();
    rafId = requestAnimationFrame(confettiLoop);
  }

  // ─── RESTART FROM RESULTS ───────────────

  document.getElementById('restart-btn').addEventListener('click', resetToMenu);

})();
