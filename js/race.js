// =============================================
//  CORSA DEGLI STRUZZI - Race Engine & Renderer
// =============================================

class RaceEngine {
  constructor(canvas, particles) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.particles = particles;

    this.ostriches   = [];
    this.cameraX     = 0;
    this.lastTime    = 0;
    this.elapsed     = 0;
    this.running     = false;
    this.finished    = false;
    this.finishOrder = [];

    this.trackLength = CONFIG.TRACK_LENGTH;

    // Pre-generate desert elements (rocks, cacti, bushes)
    this.sceneObjects = this._generateScene();

    // Crowd dots top area
    this.crowdDots = this._generateCrowd();

    // Finish line X in world units
    this.finishLineWorld = this.trackLength;

    // Camera smoothing
    this._cameraTarget = 0;
  }

  init(userChoice) {
    this.userChoice = userChoice;
    this.ostriches  = [];
    this.finishOrder = [];
    this.elapsed    = 0;
    this.finished   = false;
    this._dustTimer = 0;

    const laneCount = CONFIG.NUM_OSTRICHES;
    const H = this.canvas.height;
    // Perspective layout: horizon at 63% H, vanishing point pulls lanes together.
    // Front lane (idx=5) sits near bottom, back lane (idx=0) near horizon.
    // laneY is the foot-contact point; scale derived from distance from horizon.
    const horizonY  = H * 0.63;
    const bottomY   = H * 0.96;
    const usableH   = bottomY - horizonY;

    OSTRICH_DATA.forEach((data, idx) => {
      // t=0 → farthest (top), t=1 → nearest (bottom)
      // Use quadratic spacing so front lanes are spacious
      const t = (idx + 1) / laneCount;
      const tSq = Math.pow(t, 1.6);  // perspective squish
      const laneY = horizonY + usableH * tSq;
      // Scale: front ostrich (t=1) gets ~H*0.30 tall, back (t≈0.17) gets ~H*0.07
      const ostrichHeight = H * (0.07 + tSq * 0.23);
      this.ostriches.push(new Ostrich(data, laneY, ostrichHeight));
    });
  }

  start() {
    this.running  = true;
    this.lastTime = performance.now();
  }

  // Called every frame from main loop
  tick(timestamp) {
    if (!this.running) return { elapsed: this.elapsed, timeLeft: 0, leaderProgress: 1, finished: this.finished, finishOrder: this.finishOrder, standings: this._getStandings(), photoFinish: false };

    const dt = Math.min(timestamp - this.lastTime, 50); // cap at 50ms
    this.lastTime = timestamp;
    this.elapsed += dt;

    const raceRatio = Math.min(1, this.elapsed / CONFIG.RACE_DURATION);
    const leaderProgress = Math.max(...this.ostriches.map(o => o.progress));

    // Update ostriches — pass all for slipstream calculation
    this.ostriches.forEach(o => {
      o.update(dt, this.elapsed, CONFIG.RACE_DURATION, leaderProgress, this.ostriches);
      if (o.finished && !this.finishOrder.find(f => f.id === o.id)) {
        this.finishOrder.push({ id: o.id, time: this.elapsed });
      }
    });

    // Camera: track midpoint between leader and last (keeps pack visible)
    const worldXs    = this.ostriches.map(o => o.worldX);
    const leaderWorldX = Math.max(...worldXs);
    const tailWorldX   = Math.min(...worldXs);
    const packCenter   = (leaderWorldX + tailWorldX) / 2;
    // Bias 70% toward leader, 30% toward pack center
    const camTarget  = leaderWorldX * 0.7 + packCenter * 0.3 - CONFIG.CAMERA_LEAD;
    this._cameraTarget = camTarget;
    this.cameraX += (this._cameraTarget - this.cameraX) * 0.06;
    this.cameraX = Math.max(0, this.cameraX);

    // Commentary events
    this._updateCommentary(leaderProgress);

    // Emit dust + speed lines from ostriches
    this._dustTimer = (this._dustTimer || 0) + dt;
    if (this._dustTimer > 45) {
      this._dustTimer = 0;
      this.ostriches.forEach(o => {
        this.particles.emitDust(o.worldX - 25, o.laneY + 2, '#c9a84c');
        if (o.isBursting) {
          this.particles.emitSpeedLines(o.worldX - 10, o.laneY, o.color);
        }
      });
    }

    // Heat shimmer
    this.particles.emitHeat(this.canvas.width, this.canvas.height * 0.85);
    this.particles.update();

    // Check race end
    if (this.elapsed >= CONFIG.RACE_DURATION) {
      this._finalizeRace();
    }

    // Render
    this._render(raceRatio);

    return {
      elapsed:      this.elapsed,
      timeLeft:     Math.max(0, (CONFIG.RACE_DURATION - this.elapsed) / 1000),
      leaderProgress,
      finished:     this.finished,
      finishOrder:  this.finishOrder,
      standings:    this._getStandings(),
      photoFinish:  this._isPhotoFinish(),
    };
  }

  _finalizeRace() {
    if (this.finished) return;
    this.running  = false;
    this.finished = true;

    // Sort by progress desc, then by finishTime asc for those that finished
    this.ostriches.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    this.ostriches.forEach((o, i) => { o.finalPos = i + 1; });
    this.finishOrder = this.ostriches.map(o => ({ id: o.id, name: o.name, color: o.color, progress: o.progress, finalPos: o.finalPos }));
  }

  _getStandings() {
    return [...this.ostriches]
      .sort((a, b) => b.progress - a.progress)
      .map((o, i) => ({ pos: i + 1, id: o.id, name: o.name, color: o.color, progress: o.progress }));
  }

  _isPhotoFinish() {
    const sorted = [...this.ostriches].sort((a, b) => b.progress - a.progress);
    if (sorted.length < 2) return false;
    return Math.abs(sorted[0].progress - sorted[1].progress) < CONFIG.PHOTO_FINISH_THRESHOLD
      && sorted[0].progress > 0.95;
  }

  // ─── COMMENTARY SYSTEM ─────────────────────

  _updateCommentary(leaderProgress) {
    if (typeof voiceCommentary === 'undefined') return;

    const standings = this._getStandings();
    const leader    = standings[0];
    const second    = standings[1];
    const gap       = leader && second ? (leader.progress - second.progress) : 0;
    const bursting  = this.ostriches.filter(o => o.isBursting);

    // Detect overtakes: compare current standings with last known
    if (!this._lastLeaderId) this._lastLeaderId = leader?.id;
    const overtake = leader && this._lastLeaderId && leader.id !== this._lastLeaderId;
    const prevLeader = overtake
      ? this.ostriches.find(o => o.id === this._lastLeaderId)
      : null;
    if (overtake) this._lastLeaderId = leader.id;

    voiceCommentary.onFrame({
      leaderProgress,
      leader,
      second,
      gap,
      bursting,
      overtake,
      prevLeader,
      raceRatio: this.elapsed / CONFIG.RACE_DURATION,
    });
  }

  sayWinner(winner) {
    if (typeof voiceCommentary !== 'undefined') {
      voiceCommentary.sayWinner(winner);
    }
  }

  // ─── RENDERING ─────────────────────────────

  _render(raceRatio) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    this._drawSky(W, H);
    this._drawMountains(W, H);
    this._drawGround(W, H);
    this._drawLanes(W, H);
    this._drawSceneObjects(W, H);
    this._drawFinishLine(W, H);

    // Particles behind ostriches
    this.particles.draw(ctx, this.cameraX);

    // Draw ostriches back to front (by laneY)
    const sorted = [...this.ostriches].sort((a, b) => a.laneY - b.laneY);
    sorted.forEach(o => {
      o.draw(ctx, this.cameraX, H, o.id === this.userChoice);
    });

    this._drawVignette(W, H);
    this._drawHeatOverlay(W, H, raceRatio);
  }

  _drawSky(W, H) {
    const ctx  = this.ctx;
    const skyH = H * 0.63;
    const t    = this.elapsed / 1000;

    // ── Bright day sky: deep blue top → golden horizon (matching reference photo) ──
    const grad = ctx.createLinearGradient(0, 0, 0, skyH);
    grad.addColorStop(0,    '#1a3a6e');  // deep blue zenith
    grad.addColorStop(0.30, '#2e6bbf');  // mid blue
    grad.addColorStop(0.58, '#5ea8e8');  // bright sky blue
    grad.addColorStop(0.78, '#d4a050');  // golden horizon
    grad.addColorStop(0.90, '#e88820');  // orange near ground
    grad.addColorStop(1,    '#f5a030');  // warm horizon glow
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, skyH);

    // ── Sun: lower right, bright golden (like reference) ──
    const sunScrollFrac = this.cameraX * 0.018;
    const sunX = ((W * 0.78 - sunScrollFrac) % W + W) % W;
    const sunY = skyH * 0.82;
    const sunR = H * 0.055;

    // Far corona
    const cOuter = ctx.createRadialGradient(sunX, sunY, sunR*0.5, sunX, sunY, sunR*5.5);
    cOuter.addColorStop(0,   'rgba(255,230,100,0.35)');
    cOuter.addColorStop(0.3, 'rgba(255,180,50,0.12)');
    cOuter.addColorStop(1,   'rgba(255,140,0,0)');
    ctx.fillStyle = cOuter;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR*5.5, 0, Math.PI*2); ctx.fill();

    // Sun disc
    const sunDisc = ctx.createRadialGradient(sunX-sunR*0.3, sunY-sunR*0.3, 0, sunX, sunY, sunR);
    sunDisc.addColorStop(0,   '#ffffff');
    sunDisc.addColorStop(0.3, '#fff5c0');
    sunDisc.addColorStop(0.7, '#ffd040');
    sunDisc.addColorStop(1,   '#ffa010');
    ctx.fillStyle = sunDisc;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI*2); ctx.fill();

    // ── Light wispy clouds (high altitude, white-blue) ──
    if (!this._clouds) {
      this._clouds = [];
      for (let i = 0; i < 8; i++) {
        const pc = 3 + Math.floor(Math.random() * 4);
        const puffs = [];
        for (let p = 0; p < pc; p++)
          puffs.push({ ox: (Math.random()-0.4)*200, oy: (Math.random()-0.5)*18, r: H*0.018+Math.random()*H*0.032 });
        this._clouds.push({
          worldX: Math.random() * CONFIG.TRACK_LENGTH * 1.6,
          yFrac:  0.04 + Math.random() * 0.30,
          puffs,
          alpha:  0.25 + Math.random() * 0.22,
          speed:  0.010 + Math.random() * 0.012,
        });
      }
    }
    this._clouds.forEach(c => {
      const cx = ((c.worldX + t * c.speed * 60 - this.cameraX * 0.022) % (W*2.2) + W*2.2) % (W*2.2);
      const cy = skyH * c.yFrac;
      c.puffs.forEach(p => {
        const pg = ctx.createRadialGradient(cx+p.ox, cy+p.oy-p.r*0.2, 0, cx+p.ox, cy+p.oy, p.r);
        pg.addColorStop(0,    `rgba(255,252,245,${c.alpha})`);
        pg.addColorStop(0.55, `rgba(220,235,255,${c.alpha*0.45})`);
        pg.addColorStop(1,    'rgba(180,210,255,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(cx+p.ox, cy+p.oy, p.r, 0, Math.PI*2); ctx.fill();
      });
    });

    // ── Warm horizon glow ──
    const haze = ctx.createLinearGradient(0, skyH*0.72, 0, skyH);
    haze.addColorStop(0,   'rgba(240,160,50,0)');
    haze.addColorStop(0.6, 'rgba(248,180,60,0.22)');
    haze.addColorStop(1,   'rgba(255,200,80,0.40)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, skyH*0.72, W, skyH*0.28);
  }

  _drawDistantDunes(W, H) {
    // Replaced by _drawMountains — kept as no-op for render order
  }

  _drawMidDunes(W, H) {
    // Replaced by _drawMountains — kept as no-op for render order
  }

  _drawMountains(W, H) {
    const ctx = this.ctx;
    const baseY = H * 0.63;

    // ── 3 layers of rocky red mountains (like Arizona/Utah in reference photo) ──
    // Layer 1: farthest — bluish-purple haze, small
    const layers = [
      {
        parallax: CONFIG.PARALLAX[0],
        // colors: atmospheric blue-purple far mountains
        shadow: '#4a3050', main: '#6b4060', highlight: 'rgba(200,160,220,0.18)',
        peaks: [0.08,0.24,0.14,0.30,0.18,0.26,0.10,0.22,0.16,0.28],
        peakH: 0.22, base: 0.63,
      },
      {
        parallax: CONFIG.PARALLAX[1],
        // colors: dark reddish-brown mid mountains
        shadow: '#5a2818', main: '#7a3820', highlight: 'rgba(255,180,80,0.12)',
        peaks: [0.05,0.28,0.16,0.38,0.22,0.34,0.12,0.30,0.20,0.26],
        peakH: 0.30, base: 0.63,
      },
      {
        parallax: CONFIG.PARALLAX[1]*1.4,
        // colors: warm terracotta-red front mountains (like reference)
        shadow: '#6e2810', main: '#a03820', highlight: 'rgba(255,200,100,0.20)',
        peaks: [0.10,0.34,0.18,0.44,0.26,0.40,0.08,0.36,0.22,0.32],
        peakH: 0.38, base: 0.63,
      },
    ];

    layers.forEach((L, li) => {
      const scroll = (this.cameraX * L.parallax) % W;
      const bY = H * L.base;

      for (let rep = -1; rep <= 1; rep++) {
        const ox = rep * W - scroll;

        // Shadow pass
        ctx.fillStyle = L.shadow;
        ctx.beginPath();
        ctx.moveTo(ox, bY);
        // Build mountain silhouette from peaks array
        const n = L.peaks.length;
        for (let i = 0; i < n; i++) {
          const px = ox + (i / (n-1)) * W;
          const py = H * (L.base - L.peakH * L.peaks[i]);
          if (i === 0) ctx.lineTo(px, py);
          else {
            const ppx = ox + ((i-1)/(n-1)) * W;
            const ppy = H * (L.base - L.peakH * L.peaks[i-1]);
            ctx.bezierCurveTo(ppx + (px-ppx)*0.5, ppy, px - (px-ppx)*0.3, py, px, py);
          }
        }
        ctx.lineTo(ox+W, bY);
        ctx.closePath();
        ctx.fill();

        // Main gradient pass
        const mg = ctx.createLinearGradient(0, H*(L.base - L.peakH*0.44), 0, bY);
        mg.addColorStop(0,   L.main);
        mg.addColorStop(0.4, this._shiftColor(L.main, 15, 8, 5));
        mg.addColorStop(0.8, this._shiftColor(L.main, 25, 15, 8));
        mg.addColorStop(1,   this._shiftColor(L.main, 10, 5, 0));
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.moveTo(ox, bY);
        const n2 = L.peaks.length;
        for (let i = 0; i < n2; i++) {
          const px = ox + (i/(n2-1)) * W;
          const py = H * (L.base - L.peakH * L.peaks[i]) + 3;
          if (i === 0) ctx.lineTo(px, py);
          else {
            const ppx = ox + ((i-1)/(n2-1)) * W;
            const ppy = H * (L.base - L.peakH * L.peaks[i-1]) + 3;
            ctx.bezierCurveTo(ppx+(px-ppx)*0.5, ppy, px-(px-ppx)*0.3, py, px, py);
          }
        }
        ctx.lineTo(ox+W, bY);
        ctx.closePath();
        ctx.fill();

        // Sunlit face highlights on right sides of peaks (sun is lower right)
        if (li === 2) {
          ctx.strokeStyle = 'rgba(255,200,120,0.25)';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          for (let i = 1; i < n2-1; i++) {
            if (L.peaks[i] > L.peaks[i-1]) { // rising peak
              const px = ox + (i/(n2-1)) * W;
              const py = H * (L.base - L.peakH * L.peaks[i]);
              const ppx = ox + ((i-1)/(n2-1)) * W;
              const ppy = H * (L.base - L.peakH * L.peaks[i-1]);
              ctx.beginPath();
              ctx.moveTo(ppx, ppy);
              ctx.lineTo(px, py);
              ctx.stroke();
            }
          }
        }

        // Atmospheric haze over far layers
        if (li < 2) {
          const haze = ctx.createLinearGradient(0, H*(L.base - L.peakH*0.44), 0, bY);
          haze.addColorStop(0, `rgba(100,140,200,${0.25 - li*0.08})`);
          haze.addColorStop(1, 'rgba(100,140,200,0)');
          ctx.fillStyle = haze;
          ctx.beginPath();
          ctx.moveTo(ox, bY);
          const n3 = L.peaks.length;
          for (let i = 0; i < n3; i++) {
            const px = ox + (i/(n3-1)) * W;
            const py = H * (L.base - L.peakH * L.peaks[i]);
            if (i === 0) ctx.lineTo(px, py);
            else {
              const ppx = ox + ((i-1)/(n3-1)) * W;
              const ppy = H * (L.base - L.peakH * L.peaks[i-1]);
              ctx.bezierCurveTo(ppx+(px-ppx)*0.5, ppy, px-(px-ppx)*0.3, py, px, py);
            }
          }
          ctx.lineTo(ox+W, bY);
          ctx.closePath();
          ctx.fill();
        }
      }
    });
  }

  _shiftColor(hex, r, g, b) {
    // Parse and brighten a hex color
    const num = parseInt(hex.replace('#',''), 16);
    const nr = Math.min(255, ((num>>16)&0xff) + r);
    const ng = Math.min(255, ((num>>8)&0xff)  + g);
    const nb = Math.min(255, (num&0xff)        + b);
    return `rgb(${nr},${ng},${nb})`;
  }

  _drawGround(W, H) {
    const ctx     = this.ctx;
    const groundY = H * 0.63;
    const groundH = H - groundY;

    // ── Dusty ochre ground matching reference photo ──
    const grad = ctx.createLinearGradient(0, groundY, 0, H);
    grad.addColorStop(0,    '#c8984a');  // warm ochre at horizon
    grad.addColorStop(0.18, '#b87c30');  // mid ochre
    grad.addColorStop(0.55, '#a06820');  // darker mid
    grad.addColorStop(1,    '#7a4c10');  // dark base
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY, W, groundH);

    // ── Dusty track texture — loose diagonal streaks ──
    const ripScroll = (this.cameraX * 0.5) % 48;
    ctx.save();
    for (let rx = -48; rx < W + 48; rx += 48) {
      const x = rx - ripScroll;
      ctx.strokeStyle = `rgba(200,170,100,${0.06 + Math.random()*0.02})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + 30, H);
      ctx.stroke();
    }
    ctx.restore();

    // ── Dust haze at horizon line ──
    const dustEdge = ctx.createLinearGradient(0, groundY, 0, groundY + H*0.07);
    dustEdge.addColorStop(0, 'rgba(220,180,100,0.55)');
    dustEdge.addColorStop(1, 'rgba(200,160,80,0)');
    ctx.fillStyle = dustEdge;
    ctx.fillRect(0, groundY, W, H * 0.07);

    // ── Ground top border ──
    ctx.strokeStyle = 'rgba(100,60,10,0.40)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();
  }

  _drawLanes(W, H) {
    const ctx = this.ctx;
    const groundY = H * 0.63;
    // Starting gate shadow
    const startX = 80 - this.cameraX;
    if (startX > -200 && startX < W + 200) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(startX - 10, groundY, 20, H - groundY);
    }
  }

  _drawFinishLine(W, H) {
    const ctx = this.ctx;
    const fx = this.finishLineWorld - this.cameraX;
    if (fx < -120 || fx > W + 120) return;

    const startY   = H * 0.63;
    const lineH    = H - startY;
    const tileSize = 22;
    const cols     = 5;
    const bW       = cols * tileSize; // banner width
    const poleH    = H * 0.52;       // pole top
    const poleX1   = fx - bW / 2 - 8;
    const poleX2   = fx + bW / 2 + 8;

    // Glow aura behind finish
    const glowGrad = ctx.createRadialGradient(fx, startY, 10, fx, startY, 180);
    glowGrad.addColorStop(0,   'rgba(255,220,80,0.22)');
    glowGrad.addColorStop(0.5, 'rgba(255,150,30,0.08)');
    glowGrad.addColorStop(1,   'rgba(255,100,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(fx - 200, poleH, 400, lineH + 60);

    // Checker pattern on ground
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row * tileSize < lineH; row++) {
        ctx.fillStyle = (col + row) % 2 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)';
        ctx.fillRect(fx - bW / 2 + col * tileSize, startY + row * tileSize, tileSize, tileSize);
      }
    }

    // Poles with gradient (metallic)
    [poleX1, poleX2].forEach(px => {
      const pg = ctx.createLinearGradient(px - 5, 0, px + 5, 0);
      pg.addColorStop(0,   '#888');
      pg.addColorStop(0.4, '#eee');
      pg.addColorStop(1,   '#666');
      ctx.strokeStyle = pg;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, poleH);
      ctx.lineTo(px, startY);
      ctx.stroke();
      // Pole cap
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(px, poleH, 8, 0, Math.PI * 2);
      ctx.fill();
    });

    // Arch beam between poles
    const archGrad = ctx.createLinearGradient(poleX1, poleH - 12, poleX1, poleH + 12);
    archGrad.addColorStop(0, '#e74c3c');
    archGrad.addColorStop(1, '#c0392b');
    ctx.fillStyle = archGrad;
    ctx.fillRect(poleX1, poleH - 18, poleX2 - poleX1, 36);

    // Arch text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 15px Arial Black';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText('TRAGUARDO', fx, poleH);
    ctx.shadowBlur = 0;

    // Finish tape / ribbon
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(poleX1, startY - 3);
    ctx.lineTo(poleX2, startY - 3);
    ctx.stroke();
    ctx.setLineDash([]);

    // Distance markers — small flags along top
    ctx.fillStyle = '#e74c3c';
    [poleX1, fx, poleX2].forEach((px, i) => {
      if (i === 1) return;
      ctx.beginPath();
      ctx.moveTo(px, poleH - 18);
      ctx.lineTo(px + (i === 0 ? 16 : -16), poleH - 10);
      ctx.lineTo(px, poleH - 2);
      ctx.fill();
    });
  }

  _generateScene() {
    const objects = [];

    // Background layer: tall elements at the ground horizon
    const bgTypes = ['palm', 'pillar', 'sandwave', 'rock'];
    for (let i = 0; i < 80; i++) {
      objects.push({
        type: bgTypes[Math.floor(Math.random() * bgTypes.length)],
        worldX: 200 + Math.random() * (CONFIG.TRACK_LENGTH + 200),
        yFrac: 0.63,  // sit exactly on ground horizon
        scale: 0.9 + Math.random() * 0.7,
        layer: 'bg',
        parallax: 0.55,
      });
    }

    // Foreground layer: small ground-level details
    const fgTypes = ['rock', 'cactus', 'bush', 'bone', 'tumbleweed', 'sandpile', 'skull'];
    for (let i = 0; i < 200; i++) {
      objects.push({
        type: fgTypes[Math.floor(Math.random() * fgTypes.length)],
        worldX: Math.random() * (CONFIG.TRACK_LENGTH + 600),
        yFrac: 0.90 + Math.random() * 0.07,  // scattered near bottom of ground
        scale: 0.4 + Math.random() * 1.0,
        layer: 'fg',
        parallax: 1.0,
      });
    }

    return objects;
  }

  _drawSceneObjects(W, H) {
    const ctx = this.ctx;
    // Draw bg layer first, then fg on top
    ['bg', 'fg'].forEach(layer => {
      this.sceneObjects.filter(o => o.layer === layer).forEach(obj => {
        const sx = obj.worldX - this.cameraX * obj.parallax;
        if (sx < -150 || sx > W + 150) return;
        const sy = H * obj.yFrac;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(obj.scale, obj.scale);

        if      (obj.type === 'rock')       this._drawRock(ctx);
        else if (obj.type === 'cactus')     this._drawCactus(ctx);
        else if (obj.type === 'bush')       this._drawBush(ctx);
        else if (obj.type === 'bone')       this._drawBone(ctx);
        else if (obj.type === 'palm')       this._drawPalm(ctx);
        else if (obj.type === 'pillar')     this._drawPillar(ctx);
        else if (obj.type === 'sandwave')   this._drawSandWave(ctx);
        else if (obj.type === 'tumbleweed') this._drawTumbleweed(ctx, obj);
        else if (obj.type === 'sandpile')   this._drawSandPile(ctx);
        else if (obj.type === 'skull')      this._drawSkull(ctx);

        ctx.restore();
      });
    });
  }

  _drawRock(ctx) {
    // Base rock
    const rg = ctx.createRadialGradient(-4, -5, 0, 0, 0, 22);
    rg.addColorStop(0,   '#c8a878');
    rg.addColorStop(0.6, '#a08060');
    rg.addColorStop(1,   '#7a5a38');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 13, 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Secondary rock
    const rg2 = ctx.createRadialGradient(-8, -6, 0, -6, -4, 13);
    rg2.addColorStop(0,   '#d0b088');
    rg2.addColorStop(1,   '#907050');
    ctx.fillStyle = rg2;
    ctx.beginPath();
    ctx.ellipse(-6, -5, 11, 8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,240,200,0.2)';
    ctx.beginPath();
    ctx.ellipse(-7, -8, 5, 3, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Crack
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(2, -6); ctx.lineTo(5, 2);
    ctx.stroke();
  }
  _drawCactus(ctx) {
    const cg = ctx.createLinearGradient(-5, -40, 5, 0);
    cg.addColorStop(0, '#5a9050');
    cg.addColorStop(1, '#3a6030');
    ctx.fillStyle = cg;
    // Main trunk
    ctx.beginPath();
    ctx.roundRect(-5, -44, 10, 44, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -44, 5.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Left arm
    ctx.beginPath();
    ctx.roundRect(-20, -30, 10, 22, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-15, -30, 5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-20, -30, 14, 8, 3);
    ctx.fill();
    // Right arm
    ctx.beginPath();
    ctx.roundRect(10, -20, 10, 16, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(15, -20, 5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(6, -20, 14, 7, 3);
    ctx.fill();
    // Spines
    ctx.strokeStyle = 'rgba(255,255,200,0.6)';
    ctx.lineWidth = 0.8;
    [[-2,-38],[2,-32],[-3,-22],[2,-12],[-2,-4],[-16,-26],[-17,-22],[12,-16],[13,-12]].forEach(([x,y]) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (x < 0 ? -5 : 5), y - 2);
      ctx.stroke();
    });
    // Highlight stripe
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(-2, -44, 4, 40, 2);
    ctx.fill();
  }
  _drawBush(ctx) {
    ctx.fillStyle = '#8a6a30';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-10, 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(10, 2, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  _drawBone(ctx) {
    ctx.strokeStyle = '#e8e0cc';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();
    [[-12, 0], [12, 0]].forEach(([x, y]) => {
      ctx.fillStyle = '#e8e0cc';
      ctx.beginPath();
      ctx.arc(x, y - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y + 4, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  _drawPalm(ctx) {
    // Trunk — tapered, curved, with ring texture
    const tx = [0, 6, -3, 4];
    const ty = [0, -30, -60, -92];
    ctx.strokeStyle = '#7a4e1e';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx[0], ty[0]);
    ctx.bezierCurveTo(tx[1], ty[1], tx[2], ty[2], tx[3], ty[3]);
    ctx.stroke();
    ctx.strokeStyle = '#a06830';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(tx[0], ty[0]);
    ctx.bezierCurveTo(tx[1], ty[1], tx[2], ty[2], tx[3], ty[3]);
    ctx.stroke();
    // Trunk rings
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1.5;
    for (let r = 0; r < 6; r++) {
      const ry = -14 - r * 14;
      ctx.beginPath();
      ctx.ellipse(2 + r * 0.3, ry, 5, 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Fronds — 8 leaves, alternating
    const fronds = [
      { ax: -20, ay: -20 }, { ax: -35, ay: -10 }, { ax: -28, ay:  4 },
      { ax:  -8, ay:  8  }, { ax:  14, ay:  4 },  { ax:  30, ay: -6 },
      { ax:  26, ay: -18 },{ ax:  10, ay: -26 },
    ];
    fronds.forEach(({ ax, ay }, i) => {
      const g = ctx.createLinearGradient(tx[3], ty[3], tx[3] + ax, ty[3] + ay);
      g.addColorStop(0, '#2a6020');
      g.addColorStop(1, '#4a9035');
      ctx.strokeStyle = i % 2 === 0 ? '#3a8028' : '#4a9035';
      ctx.lineWidth = 4 - (i % 2);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx[3], ty[3]);
      ctx.quadraticCurveTo(
        tx[3] + ax * 0.55 + (i % 2 ? 5 : -5), ty[3] + ay * 0.4,
        tx[3] + ax, ty[3] + ay
      );
      ctx.stroke();
    });
    // Coconuts cluster
    [[4,-90],[9,-86],[0,-86],[-4,-83]].forEach(([cx,cy]) => {
      const cg = ctx.createRadialGradient(cx-1, cy-1, 0, cx, cy, 5);
      cg.addColorStop(0, '#a06830');
      cg.addColorStop(1, '#604010');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    });
  }

  _drawPillar(ctx) {
    // Ancient ruin pillar
    ctx.fillStyle = '#c8b890';
    ctx.fillRect(-12, -70, 24, 70);
    // Cap
    ctx.fillStyle = '#d8c8a0';
    ctx.fillRect(-16, -80, 32, 12);
    // Base
    ctx.fillStyle = '#b8a878';
    ctx.fillRect(-14, -6, 28, 6);
    // Cracks
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-4, -60); ctx.lineTo(-2, -30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, -50); ctx.lineTo(7, -20); ctx.stroke();
    // Broken top edge
    ctx.fillStyle = '#c8b890';
    ctx.beginPath();
    ctx.moveTo(-16, -80); ctx.lineTo(-8, -88); ctx.lineTo(0, -82);
    ctx.lineTo(10, -90); ctx.lineTo(16, -80); ctx.closePath();
    ctx.fill();
  }

  _drawSandWave(ctx) {
    // Wind-carved sand ridge
    ctx.fillStyle = 'rgba(220, 170, 80, 0.5)';
    ctx.beginPath();
    ctx.moveTo(-60, 0);
    ctx.bezierCurveTo(-30, -18, 0, -22, 30, -14);
    ctx.bezierCurveTo(50, -8, 60, 0, 60, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(240, 200, 110, 0.3)';
    ctx.beginPath();
    ctx.moveTo(-50, 0);
    ctx.bezierCurveTo(-20, -10, 10, -13, 40, -6);
    ctx.bezierCurveTo(50, -3, 55, 0, 55, 0);
    ctx.closePath();
    ctx.fill();
  }

  _drawTumbleweed(ctx, obj) {
    const t = (this.elapsed / 600 + (obj.worldX * 0.01));
    ctx.save();
    ctx.rotate(t);
    ctx.strokeStyle = '#8a6a30';
    ctx.lineWidth = 2;
    for (let a = 0; a < Math.PI; a += Math.PI / 4) {
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 6, a, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawSandPile(ctx) {
    ctx.fillStyle = 'rgba(210, 160, 70, 0.7)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(235, 195, 100, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-5, -4, 14, 5, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawSkull(ctx) {
    ctx.fillStyle = '#e0d8c0';
    ctx.beginPath();
    ctx.ellipse(0, -8, 10, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eye sockets
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(-4, -10, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, -10, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    // Jaw
    ctx.fillStyle = '#d8d0b8';
    ctx.fillRect(-8, -2, 16, 6);
    // Teeth
    ctx.fillStyle = 'white';
    [-5, -1, 3].forEach(x => {
      ctx.fillRect(x, -1, 3, 5);
    });
  }

  _generateCrowd() {
    const dots = [];
    for (let i = 0; i < 500; i++) {
      const hue = Math.random() * 360;
      dots.push({
        worldX:    Math.random() * CONFIG.TRACK_LENGTH * 1.15,
        yFrac:     0.04 + Math.random() * 0.13,
        color:     `hsl(${hue}, 75%, 62%)`,
        bodyColor: `hsl(${hue}, 55%, 38%)`,
        radius:    2.5 + Math.random() * 3.5,
        bobOffset: Math.random() * Math.PI * 2,
        armPhase:  Math.random() * Math.PI * 2,
        waving:    Math.random() > 0.55,
        row:       Math.floor(Math.random() * 3), // depth rows
      });
    }
    // Sort by row so front row draws on top
    dots.sort((a, b) => a.row - b.row);
    return dots;
  }

  _drawCrowd(W, H) {
    const ctx = this.ctx;
    const t   = this.elapsed / 400;
    this.crowdDots.forEach(d => {
      const sx = d.worldX - this.cameraX * CONFIG.PARALLAX[1];
      if (sx < -20 || sx > W + 20) return;
      const rowScale = 0.7 + d.row * 0.15;
      const sy = H * d.yFrac + d.row * H * 0.025;
      const bob = Math.sin(t + d.bobOffset) * (d.waving ? 4 : 1.5);

      ctx.save();
      ctx.translate(sx, sy + bob);
      ctx.scale(rowScale, rowScale);

      // Body
      ctx.fillStyle = d.bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, d.radius + 2, d.radius * 0.8, d.radius * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(0, 0, d.radius, 0, Math.PI * 2);
      ctx.fill();

      // Waving arm
      if (d.waving) {
        const armAngle = -0.8 + Math.sin(t * 2.5 + d.armPhase) * 0.6;
        ctx.strokeStyle = d.bodyColor;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(d.radius * 0.6, d.radius + 1);
        ctx.lineTo(
          d.radius * 0.6 + Math.cos(armAngle) * d.radius * 1.8,
          d.radius + 1 + Math.sin(armAngle) * d.radius * 1.8
        );
        ctx.stroke();
      }

      ctx.restore();
    });
  }

  // ─── REMOVED: stands replaced by desert landscape ───
  _drawStands_DISABLED(W, H) {
    const ctx = this.ctx;
    const t   = this.elapsed / 1000;

    // STATIC — no camera scroll. Stands are a fixed backdrop.
    const topY  = H * 0.04;   // top of stand area
    const baseY = H * 0.575;  // bottom — where dunes begin
    const standH = baseY - topY;

    // ── 1. Background: dark concrete fill ────────────
    const bg = ctx.createLinearGradient(0, topY, 0, baseY);
    bg.addColorStop(0,    '#12152a');
    bg.addColorStop(0.5,  '#1c2240');
    bg.addColorStop(1,    '#28304a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, topY, W, standH);

    // ── 2. Tier rows: alternating concrete steps ─────
    // Each "row" is a thick band — darker concrete + lighter crowd zone
    const numRows = 9;
    const rowH    = standH / numRows;

    // Pre-generate crowd color patches once (static, indexed by row & x-cell)
    if (!this._crowdMap) {
      this._crowdMap = [];
      const cellW = 48; // width of each color cell
      const cols  = Math.ceil(W / cellW) + 2;
      for (let row = 0; row < numRows; row++) {
        this._crowdMap[row] = [];
        for (let col = 0; col < cols; col++) {
          // Each cell is a hue — mix of warm tones (jerseys) with occasional bright accent
          const hue = Math.floor(Math.random() * 360);
          const sat = 40 + Math.random() * 45;
          const lit = 28 + Math.random() * 22;
          this._crowdMap[row][col] = { hue, sat, lit,
            phase: Math.random() * Math.PI * 2,
            speed: 0.6 + Math.random() * 0.8,
          };
        }
      }
      // A handful of large banner / tifo rectangles spanning multiple cells
      this._tifos = [];
      const tifoColors = ['#c0392b','#e67e22','#f1c40f','#27ae60','#2980b9','#8e44ad'];
      for (let i = 0; i < 5; i++) {
        this._tifos.push({
          xFrac:  0.05 + Math.random() * 0.82,
          row:    Math.floor(Math.random() * (numRows - 2)) + 1,
          wFrac:  0.06 + Math.random() * 0.10,
          color:  tifoColors[i % tifoColors.length],
          phase:  Math.random() * Math.PI * 2,
        });
      }
    }

    const cellW = 48;

    for (let row = 0; row < numRows; row++) {
      const ry     = topY + row * rowH;
      // Perspective: rows higher up are narrower/darker (further away)
      const depth  = row / numRows;         // 0 = top (far), 1 = bottom (near)
      const crowdH = rowH * (0.52 + depth * 0.22); // crowd zone height within row
      const stepH  = rowH - crowdH;         // concrete step ledge below crowd

      // Concrete step ledge
      const stepGrad = ctx.createLinearGradient(0, ry + crowdH, 0, ry + rowH);
      stepGrad.addColorStop(0, `rgba(18,22,40,0.95)`);
      stepGrad.addColorStop(1, `rgba(10,14,28,0.95)`);
      ctx.fillStyle = stepGrad;
      ctx.fillRect(0, ry + crowdH, W, stepH + 1);

      // Crowd color wash — cells of impressionistic colour
      const cols = this._crowdMap[row];
      for (let col = 0; col < cols.length; col++) {
        const c   = cols[col];
        const cx  = col * cellW;
        // Slight vertical shimmer — simulates crowd movement
        const shimmer = Math.sin(t * c.speed + c.phase) * 1.2;
        // Darken top rows for depth/perspective
        const litAdj  = c.lit * (0.55 + depth * 0.55);
        ctx.fillStyle = `hsl(${c.hue},${c.sat}%,${litAdj}%)`;
        ctx.fillRect(cx, ry + shimmer, cellW, crowdH - shimmer);
      }

      // Row separator: thin concrete line
      ctx.fillStyle = 'rgba(8,10,22,0.85)';
      ctx.fillRect(0, ry + crowdH - 1, W, 2);

      // Top highlight on each step ledge (catches stadium light)
      ctx.fillStyle = `rgba(80,100,160,${0.06 + depth * 0.06})`;
      ctx.fillRect(0, ry + crowdH, W, 2);
    }

    // ── 3. Large tifo / banner rectangles ────────────
    this._tifos.forEach(tf => {
      const tx = tf.xFrac * W;
      const ty = topY + tf.row * rowH + rowH * 0.08;
      const tw = tf.wFrac * W;
      const th = rowH * 0.75;
      // Gentle wave distortion on banner — just alpha pulse
      const pulse = 0.75 + Math.sin(t * 0.8 + tf.phase) * 0.12;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = tf.color;
      ctx.fillRect(tx, ty, tw, th);
      // White stripe through middle
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(tx + 4, ty + th * 0.35, tw - 8, th * 0.28);
      ctx.globalAlpha = 1;
    });

    // ── 4. Vertical aisle shadows (break repetition) ──
    const aislePositions = [0.18, 0.36, 0.54, 0.72, 0.88];
    aislePositions.forEach(xf => {
      const ax = xf * W;
      const ag = ctx.createLinearGradient(ax - 8, 0, ax + 8, 0);
      ag.addColorStop(0,   'rgba(0,0,0,0)');
      ag.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      ag.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = ag;
      ctx.fillRect(ax - 8, topY, 16, standH);
    });

    // ── 5. Bottom fade into dunes ─────────────────────
    const fade = ctx.createLinearGradient(0, baseY - standH * 0.14, 0, baseY);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(5,5,15,0.70)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, baseY - standH * 0.14, W, standH * 0.14);

    // ── 6. Advertising hoarding at base (scrolls with track) ──
    const boardH  = H * 0.022;
    const boardY  = baseY - boardH;
    const boardW  = 110;
    const adScroll = ((this.cameraX * 0.9) % boardW + boardW) % boardW;
    const adPalette = [
      { bg: '#c0392b', fg: '#ffffff' },
      { bg: '#2471a3', fg: '#ffffff' },
      { bg: '#f39c12', fg: '#1a1a1a' },
      { bg: '#1e8449', fg: '#ffffff' },
      { bg: '#6c3483', fg: '#ffffff' },
    ];
    for (let ax = -adScroll; ax < W + boardW; ax += boardW) {
      const idx = Math.floor(((ax + adScroll) / boardW + 100)) % adPalette.length;
      const ad  = adPalette[idx];
      ctx.fillStyle = ad.bg;
      ctx.fillRect(ax, boardY, boardW - 2, boardH);
      // Simple stripe to suggest text/logo
      ctx.fillStyle = ad.fg;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(ax + 10, boardY + boardH * 0.28, boardW - 22, boardH * 0.44);
      ctx.globalAlpha = 1;
    }
    // Board top edge
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, boardY, W, 1.5);
  }

  _drawVignette(W, H) {
    const ctx = this.ctx;
    // Corner vignette
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.95);
    grad.addColorStop(0,   'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.1)');
    grad.addColorStop(1,   'rgba(0,0,0,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Thin top letterbox bar
    const topBar = ctx.createLinearGradient(0, 0, 0, H * 0.06);
    topBar.addColorStop(0, 'rgba(0,0,0,0.5)');
    topBar.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topBar;
    ctx.fillRect(0, 0, W, H * 0.06);
  }

  _drawHeatOverlay(W, H, raceRatio) {
    const ctx = this.ctx;
    // Wavy heat distortion bands near the ground
    if (Math.random() > 0.93) {
      const y = H * (0.60 + Math.random() * 0.15);
      const shimGrad = ctx.createLinearGradient(0, y, 0, y + 6);
      shimGrad.addColorStop(0,   'rgba(255,200,100,0)');
      shimGrad.addColorStop(0.5, `rgba(255,200,100,${0.03 + raceRatio * 0.04})`);
      shimGrad.addColorStop(1,   'rgba(255,200,100,0)');
      ctx.fillStyle = shimGrad;
      ctx.fillRect(0, y, W, 6);
    }
    // Strong ground haze
    const hazeY = H * 0.62;
    const hazeGrad = ctx.createLinearGradient(0, hazeY - 8, 0, hazeY + 8);
    hazeGrad.addColorStop(0, 'rgba(255,180,60,0)');
    hazeGrad.addColorStop(0.5, `rgba(255,200,80,${0.06 + Math.sin(this.elapsed / 600) * 0.02})`);
    hazeGrad.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, hazeY - 8, W, 16);
  }

  getOstrichById(id) {
    return this.ostriches.find(o => o.id === id);
  }

  getWinner() {
    return this.finishOrder[0] || null;
  }

  resize(W, H) {
    const groundTop = H * 0.63;
    const groundBot = H * 0.93;
    const usableH   = groundBot - groundTop;
    const laneCount = CONFIG.NUM_OSTRICHES;
    const laneStep  = usableH / laneCount;
    this.ostriches.forEach((o, idx) => {
      o.laneY = groundTop + laneStep * idx + laneStep * 0.55;
    });
  }
}
