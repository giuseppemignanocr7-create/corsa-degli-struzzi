// =============================================
//  CORSA DEGLI STRUZZI - UI Controller
// =============================================

class UIController {
  constructor() {
    this.screenSelect    = document.getElementById('screen-select');
    this.screenCountdown = document.getElementById('screen-countdown');
    this.screenHud       = document.getElementById('screen-hud');
    this.screenResults   = document.getElementById('screen-results');

    this.hudTimer        = document.getElementById('hud-timer');
    this.hudStandings    = document.getElementById('hud-standings');
    this.hudProgressTrack= document.getElementById('hud-progress-track');
    this.hudPlayerPos    = document.getElementById('hud-player-pos');
    this.countdownNum    = document.getElementById('countdown-number');
    this.photoFinishBanner = document.getElementById('photo-finish-banner');

    this.selectedId      = null;
    this.startBtn        = document.getElementById('start-btn');

    this._standingsUpdateTimer = 0;
    this._progressMarkers      = [];
    this._photoFinishShown     = false;

    this._buildSelectionCards();
    this._buildProgressMarkers();
  }

  // ─── SELECTION SCREEN ────────────────────

  _buildSelectionCards() {
    const grid = document.getElementById('ostrich-grid');
    OSTRICH_DATA.forEach(data => {
      const card = document.createElement('div');
      card.className = 'ostrich-card';
      card.dataset.id = data.id;
      card.style.setProperty('--card-color', data.color);
      card.innerHTML = `
        <div class="card-badge" style="background:${data.color};"></div>
        <div class="card-number" style="color:${data.color}">#${data.id}</div>
        <div class="card-name">${data.name}</div>
        <div class="card-odds" id="odds-${data.id}">—</div>
      `;
      card.addEventListener('click', () => this._selectOstrich(data.id));
      grid.appendChild(card);
    });
  }

  refreshOdds() {
    OSTRICH_DATA.forEach(data => {
      const el = document.getElementById(`odds-${data.id}`);
      if (el) el.textContent = `${data.odds.toFixed(1)}x`;
    });
  }

  _selectOstrich(id) {
    this.selectedId = id;
    document.querySelectorAll('.ostrich-card').forEach(c => {
      c.classList.toggle('selected', parseInt(c.dataset.id) === id);
    });
    this.startBtn.classList.add('visible');
  }

  // ─── COUNTDOWN SCREEN ────────────────────

  async showCountdown(onComplete) {
    this.screenSelect.classList.add('hidden');
    this.screenCountdown.classList.remove('hidden');

    for (let n = CONFIG.COUNTDOWN_FROM; n >= 1; n--) {
      this.countdownNum.textContent = n;
      this.countdownNum.classList.remove('go');
      // Re-trigger animation
      this.countdownNum.style.animation = 'none';
      void this.countdownNum.offsetHeight; // reflow
      this.countdownNum.style.animation = '';
      await this._sleep(900);
    }

    this.countdownNum.textContent = 'VIA!';
    this.countdownNum.classList.add('go');
    this.countdownNum.style.animation = 'none';
    void this.countdownNum.offsetHeight;
    this.countdownNum.style.animation = '';

    await this._sleep(700);
    this.screenCountdown.classList.add('hidden');
    onComplete();
  }

  // ─── HUD ────────────────────────────────

  showHud() {
    this.screenHud.classList.remove('hidden');
  }

  updateHud(info, userChoice) {
    // Timer
    const tl = info.timeLeft;
    this.hudTimer.textContent = tl.toFixed(1) + 's';
    this.hudTimer.removeAttribute('class');
    if (tl < 8) {
      this.hudTimer.setAttribute('class', 'danger');
    } else if (tl < 20) {
      this.hudTimer.setAttribute('class', 'warning');
    }

    // Standings sidebar (throttle to every 250ms for responsive overtake display)
    this._standingsUpdateTimer += 16;
    if (this._standingsUpdateTimer > 250) {
      this._standingsUpdateTimer = 0;
      this._updateStandingsSidebar(info.standings, userChoice);
    }

    // Progress bar markers
    this._updateProgressMarkers(info.standings, userChoice);

    // Player position widget
    const playerStanding = info.standings.find(s => s.id === userChoice);
    if (playerStanding) {
      const posEl = document.getElementById('hud-player-pos-num');
      if (posEl) {
        posEl.textContent = playerStanding.pos;
        const suffix = ['', 'st', 'nd', 'rd'][playerStanding.pos] || 'th';
        document.getElementById('hud-player-suffix').textContent = suffix;
      }
    }

    // Photo finish banner
    if (info.photoFinish && !this._photoFinishShown) {
      this._photoFinishShown = true;
      this.photoFinishBanner.classList.add('show');
      setTimeout(() => this.photoFinishBanner.classList.remove('show'), 3000);
    }
  }

  _updateStandingsSidebar(standings, userChoice) {
    const body = document.getElementById('standings-body');
    if (!body) return;
    body.innerHTML = '';
    const posLabels = ['', '🥇', '🥈', '🥉', '4', '5', '6'];
    standings.forEach(s => {
      const row = document.createElement('div');
      row.className = 'standing-row' + (s.id === userChoice ? ' player-row' : '');
      const medal = posLabels[s.pos] || s.pos;
      const isPlayer = s.id === userChoice;
      row.innerHTML = `
        <span class="standing-pos">${medal}</span>
        <span class="standing-dot" style="background:${s.color}; box-shadow: 0 0 6px ${s.color}"></span>
        <span class="standing-name">#${s.id}${isPlayer ? ' ⭐' : ''}</span>
      `;
      body.appendChild(row);
    });
  }

  _buildProgressMarkers() {
    const track = this.hudProgressTrack;
    if (!track) return;
    OSTRICH_DATA.forEach(data => {
      const marker = document.createElement('div');
      marker.className = 'progress-marker';
      marker.id = `pm-${data.id}`;
      marker.style.background = data.color;
      marker.style.left = '0%';
      marker.textContent = data.id;
      track.appendChild(marker);
      this._progressMarkers.push({ id: data.id, el: marker });
    });
  }

  _updateProgressMarkers(standings, userChoice) {
    standings.forEach(s => {
      const m = this._progressMarkers.find(m => m.id === s.id);
      if (m) {
        m.el.style.left = Math.min(96, s.progress * 100) + '%';
        m.el.style.zIndex = s.id === userChoice ? 10 : 5;
        m.el.style.border = s.id === userChoice ? '2px solid #f1c40f' : '2px solid white';
      }
    });
  }

  // ─── RESULTS SCREEN ─────────────────────

  showResults(finishOrder, userChoice, particles, canvas) {
    this.screenHud.classList.add('hidden');
    this.screenResults.classList.remove('hidden');

    const winner = finishOrder[0];
    if (!winner) return;

    // Confetti burst
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        particles.emitConfetti(
          canvas.width * (0.2 + Math.random() * 0.6),
          canvas.height * (0.1 + Math.random() * 0.3),
          80
        );
      }, i * 300);
    }

    // Title
    const title = document.getElementById('results-title');
    title.innerHTML = `🏆 STRUZZO #${winner.id} VINCE!`;

    // Subtitle
    const sub = document.getElementById('results-subtitle');
    const playerData = OSTRICH_DATA.find(o => o.id === userChoice);
    if (winner.id === userChoice) {
      sub.textContent = `COMPLIMENTI! Hai vinto scommettendo su ${winner.name}!`;
      sub.className = 'win';
    } else {
      const playerPos = finishOrder.find(o => o.id === userChoice);
      sub.textContent = `Peccato! Il tuo #${userChoice} è arrivato ${playerPos ? playerPos.finalPos + 'º' : ''}. Riprova!`;
      sub.className = 'lose';
    }

    // Podium
    this._buildPodium(finishOrder);

    // Standings table
    this._buildStandingsTable(finishOrder, userChoice);
  }

  _buildPodium(finishOrder) {
    const podium = document.getElementById('podium');
    if (!podium || finishOrder.length < 3) return;

    const order = [finishOrder[1], finishOrder[0], finishOrder[2]]; // visual: 2nd, 1st, 3rd
    const classes = ['p2', 'p1', 'p3'];
    const nums = ['2°', '1°', '3°'];

    podium.innerHTML = '';
    order.forEach((o, i) => {
      if (!o) return;
      const data = OSTRICH_DATA.find(d => d.id === o.id);
      const color = data ? data.color : '#888';
      const name  = data ? data.name : `#${o.id}`;
      const block = document.createElement('div');
      block.className = 'podium-block';
      block.innerHTML = `
        <div class="podium-ostrich-icon" style="background:${color}">#${o.id}</div>
        <div class="podium-name">${name}</div>
        <div class="podium-stand ${classes[i]}">
          <span class="podium-stand-num">${nums[i]}</span>
        </div>
      `;
      podium.appendChild(block);
    });
  }

  _buildStandingsTable(finishOrder, userChoice) {
    const table = document.getElementById('standings-table');
    if (!table) return;
    table.innerHTML = '';
    finishOrder.forEach((o, i) => {
      const data = OSTRICH_DATA.find(d => d.id === o.id);
      const tr = document.createElement('tr');
      if (o.id === userChoice) tr.className = 'player-highlight';
      const pct = (o.progress * 100).toFixed(1);
      tr.innerHTML = `
        <td>${i + 1}°</td>
        <td>
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${data ? data.color : '#888'};margin-right:6px;vertical-align:middle;"></span>
          #${o.id} ${data ? data.name : ''}${o.id === userChoice ? ' ★' : ''}
        </td>
        <td>${pct}%</td>
      `;
      table.appendChild(tr);
    });
  }

  // ─── UTILS ──────────────────────────────

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
