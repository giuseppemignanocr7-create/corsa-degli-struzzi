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

    // ── Photorealistic sky: 8-stop gradient matching golden hour desert photo ──
    // Top = deep cobalt, mid = saturated sky blue, bottom = warm gold/amber band
    const grad = ctx.createLinearGradient(0, 0, 0, skyH);
    grad.addColorStop(0.00, '#0d2b5e');  // deep cobalt zenith
    grad.addColorStop(0.12, '#1a4a8a');  // royal blue
    grad.addColorStop(0.28, '#2468b8');  // medium sky blue
    grad.addColorStop(0.46, '#4a96d8');  // light sky blue
    grad.addColorStop(0.62, '#78b8e8');  // pale blue near horizon
    grad.addColorStop(0.74, '#d4903a');  // golden band
    grad.addColorStop(0.87, '#e8720a');  // orange
    grad.addColorStop(1.00, '#f0900a');  // amber at ground
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, skyH);

    // ── Sun: right side, large, white-gold ──
    const sunX = W * 0.82 - (this.cameraX * 0.015) % (W * 0.5);
    const sunY = skyH * 0.80;
    const sunR = H * 0.052;

    // Sun glow layers (no hard edges)
    for (let layer = 4; layer >= 0; layer--) {
      const r = sunR * (1 + layer * 1.2);
      const a = [0.38, 0.18, 0.10, 0.05, 0.02][layer];
      const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, r);
      sg.addColorStop(0,   `rgba(255,248,220,${a})`);
      sg.addColorStop(0.6, `rgba(255,210,80,${a*0.4})`);
      sg.addColorStop(1,   'rgba(255,160,0,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sunX, sunY, r, 0, Math.PI*2); ctx.fill();
    }
    // Sun disc
    const sd = ctx.createRadialGradient(sunX-sunR*0.2, sunY-sunR*0.2, 0, sunX, sunY, sunR);
    sd.addColorStop(0,   '#ffffff');
    sd.addColorStop(0.4, '#fff8d0');
    sd.addColorStop(0.85,'#ffd050');
    sd.addColorStop(1,   '#ffa010');
    ctx.fillStyle = sd; ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI*2); ctx.fill();

    // ── Atmospheric scattering: thin warm band at exact horizon ──
    const scatter = ctx.createLinearGradient(0, skyH*0.60, 0, skyH);
    scatter.addColorStop(0,   'rgba(255,180,60,0)');
    scatter.addColorStop(0.45,'rgba(255,170,50,0.15)');
    scatter.addColorStop(0.78,'rgba(255,150,30,0.28)');
    scatter.addColorStop(1,   'rgba(255,130,10,0.18)');
    ctx.fillStyle = scatter;
    ctx.fillRect(0, skyH*0.60, W, skyH*0.40);
  }

  _drawDistantDunes(W, H) {}
  _drawMidDunes(W, H) {}

  // ── Seeded pseudo-random (deterministic, no Math.random in render loop) ──
  _rng(seed) {
    let s = seed ^ 0xdeadbeef;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    return ((s ^ (s >>> 16)) >>> 0) / 0xffffffff;
  }

  _drawMountains(W, H) {
    const ctx   = this.ctx;
    const baseY = H * 0.63;

    // ── 3 parallax mountain layers, each rendered as LOW-POLY FACETED ROCK ──
    // Each layer: generate a ridgeline of vertices, then triangulate into
    // lit/shadow facets — looks like real rock instead of cartoon blob.
    const layers = [
      // Far layer: hazy blue-purple (atmospheric perspective)
      { parallax: CONFIG.PARALLAX[0]*0.5, seed: 7,
        baseColor: [88, 70, 110], shadowMul: 0.55, litMul: 1.25,
        heightFrac: 0.28, vertCount: 22, base: 0.63, haze: [80,110,180,0.35] },
      // Mid layer: dark brownish red
      { parallax: CONFIG.PARALLAX[0]*0.85, seed: 13,
        baseColor: [110, 48, 28], shadowMul: 0.50, litMul: 1.30,
        heightFrac: 0.38, vertCount: 20, base: 0.63, haze: [80,100,160,0.18] },
      // Front layer: rich terracotta-red (closest, no haze)
      { parallax: CONFIG.PARALLAX[1]*0.9, seed: 31,
        baseColor: [148, 54, 22], shadowMul: 0.48, litMul: 1.40,
        heightFrac: 0.48, vertCount: 18, base: 0.63, haze: null },
    ];

    // Sun direction (from lower-right): used for facet lighting
    const sunDirX = 0.7, sunDirY = -0.7;

    layers.forEach((L) => {
      const scroll = (this.cameraX * L.parallax) % W;
      const bY     = H * L.base;
      const maxH   = H * L.heightFrac;

      // Build ridgeline vertices (deterministic from seed)
      // We generate enough points for 2x width so tiling is seamless
      const verts = [];
      const N = L.vertCount * 2 + 2;
      for (let i = 0; i <= N; i++) {
        const t  = i / N;
        // Mix multiple frequencies for natural ridge
        const h  = (
          this._rng(L.seed + i*3)     * 0.55 +
          this._rng(L.seed + i*3 + 1) * 0.28 +
          this._rng(L.seed + i*3 + 2) * 0.17
        );
        verts.push({ x: t * W * 2, y: bY - h * maxH });
      }
      // Add a mid-point noise pass for jaggedness (rocky look)
      const jagged = [];
      jagged.push({ x: 0, y: bY });
      for (let i = 0; i < verts.length - 1; i++) {
        jagged.push(verts[i]);
        // Insert extra vertex between each pair for angular rocky edges
        const mx = (verts[i].x + verts[i+1].x) * 0.5;
        const myBase = (verts[i].y + verts[i+1].y) * 0.5;
        const jitter = (this._rng(L.seed + i*7 + 99) - 0.5) * maxH * 0.22;
        jagged.push({ x: mx, y: myBase + jitter });
      }
      jagged.push(verts[verts.length-1]);
      jagged.push({ x: W * 2, y: bY });

      // Render for -W, 0, +W offsets to fill any scroll gap
      for (let rep = -1; rep <= 1; rep++) {
        const ox = rep * W * 2 - (scroll * 2) % (W * 2);
        if (ox > W + 10 || ox + W * 2 < -10) continue;

        // Draw triangulated facets
        for (let i = 1; i < jagged.length - 2; i++) {
          const A = { x: jagged[i].x   + ox, y: jagged[i].y   };
          const B = { x: jagged[i+1].x + ox, y: jagged[i+1].y };
          const botL = { x: A.x, y: bY + 2 };
          const botR = { x: B.x, y: bY + 2 };

          // Facet normal
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          // Normal pointing outward (upward for mountain)
          const nx = -dy / len, ny = dx / len;
          // Dot with sun direction
          const dot = Math.max(0, Math.min(1, nx*sunDirX + ny*sunDirY));

          // Shade the facet
          const [br, bg, bb] = L.baseColor;
          const shade = L.shadowMul + dot * (L.litMul - L.shadowMul);
          const fr = Math.min(255, br * shade) | 0;
          const fg = Math.min(255, bg * shade) | 0;
          const fb = Math.min(255, bb * shade) | 0;

          ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
          ctx.beginPath();
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
          ctx.lineTo(botR.x, botR.y);
          ctx.lineTo(botL.x, botL.y);
          ctx.closePath();
          ctx.fill();
        }

        // Atmospheric haze overlay on far layers
        if (L.haze) {
          const [hr, hg, hb, ha] = L.haze;
          const hzGrad = ctx.createLinearGradient(0, bY - maxH, 0, bY);
          hzGrad.addColorStop(0,   `rgba(${hr},${hg},${hb},${ha})`);
          hzGrad.addColorStop(1,   `rgba(${hr},${hg},${hb},0)`);
          ctx.fillStyle = hzGrad;
          ctx.fillRect(ox, bY - maxH, W * 2, maxH + 2);
        }
      }
    });
  }

  _drawGround(W, H) {
    const ctx     = this.ctx;
    const groundY = H * 0.63;
    const groundH = H - groundY;

    // ── Base: 5-stop photorealistic desert ground gradient ──
    const grad = ctx.createLinearGradient(0, groundY, 0, H);
    grad.addColorStop(0.00, '#d4a055');  // bright lit horizon
    grad.addColorStop(0.08, '#c08840');  // warm ochre
    grad.addColorStop(0.28, '#aa7030');  // mid tone
    grad.addColorStop(0.60, '#8a5420');  // darker
    grad.addColorStop(1.00, '#6a3c10');  // deep shadow near bottom
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY, W, groundH);

    // ── Horizontal ground banding (natural soil layer variation) ──
    // These thin horizontal strips simulate the layered look of desert soil
    const bands = [
      { yFrac: 0.08, color: 'rgba(210,175,90,0.18)',  h: 3 },
      { yFrac: 0.18, color: 'rgba(160,110,40,0.14)',  h: 2 },
      { yFrac: 0.32, color: 'rgba(200,155,70,0.12)',  h: 3 },
      { yFrac: 0.48, color: 'rgba(140, 90,25,0.12)',  h: 2 },
      { yFrac: 0.65, color: 'rgba(180,130,55,0.10)',  h: 2 },
    ];
    bands.forEach(b => {
      ctx.fillStyle = b.color;
      ctx.fillRect(0, groundY + groundH * b.yFrac, W, b.h);
    });

    // ── Perspective track grooves (converge to horizon) ──
    const trackScroll = (this.cameraX * 0.8) % 80;
    ctx.save();
    ctx.strokeStyle = 'rgba(160,120,55,0.22)';
    ctx.lineWidth = 1;
    for (let tx = -80; tx < W + 80; tx += 80) {
      const x = tx - trackScroll;
      // Lines converge toward horizon center
      ctx.beginPath();
      ctx.moveTo(W/2 + (x - W/2) * 0.05, groundY + 2);  // near-horizon (narrow)
      ctx.lineTo(x, H);                                    // ground level (full spread)
      ctx.stroke();
    }
    ctx.restore();

    // ── Bright dust scatter at horizon ──
    const dustEdge = ctx.createLinearGradient(0, groundY, 0, groundY + H*0.10);
    dustEdge.addColorStop(0,   'rgba(230,195,120,0.60)');
    dustEdge.addColorStop(0.5, 'rgba(210,170,90,0.18)');
    dustEdge.addColorStop(1,   'rgba(190,145,60,0)');
    ctx.fillStyle = dustEdge;
    ctx.fillRect(0, groundY, W, H * 0.10);
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
    const rng = (s) => this._rng(s);

    // ── BACKGROUND: only sparse saguaro cactus silhouettes + distant rock formations ──
    // No palms, no pillars — pure Arizona desert
    for (let i = 0; i < 28; i++) {
      const seed = i * 17;
      objects.push({
        type:    rng(seed) > 0.38 ? 'cactus_sil' : 'rock_cluster',
        worldX:  300 + rng(seed+1) * (CONFIG.TRACK_LENGTH + 400),
        yFrac:   0.625 + rng(seed+2) * 0.005,
        scale:   0.5 + rng(seed+3) * 0.8,
        layer:   'bg',
        parallax: 0.40 + rng(seed+4) * 0.15,
      });
    }

    // ── FOREGROUND: rocks only (no cartoon skulls/bones) ──
    for (let i = 0; i < 60; i++) {
      const seed = 1000 + i * 11;
      objects.push({
        type:    'rock',
        worldX:  rng(seed) * (CONFIG.TRACK_LENGTH + 600),
        yFrac:   0.88 + rng(seed+1) * 0.09,
        scale:   0.3 + rng(seed+2) * 0.9,
        layer:   'fg',
        parallax: 1.0,
      });
    }

    return objects;
  }

  _drawSceneObjects(W, H) {
    const ctx = this.ctx;
    ['bg', 'fg'].forEach(layer => {
      this.sceneObjects.filter(o => o.layer === layer).forEach(obj => {
        const sx = obj.worldX - this.cameraX * obj.parallax;
        if (sx < -200 || sx > W + 200) return;
        const sy = H * obj.yFrac;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(obj.scale, obj.scale);
        if      (obj.type === 'rock')         this._drawRock(ctx);
        else if (obj.type === 'cactus_sil')   this._drawCactusSilhouette(ctx);
        else if (obj.type === 'rock_cluster') this._drawRockCluster(ctx);
        ctx.restore();
      });
    });
  }

  _drawRock(ctx) {
    // Low-poly angular rock — looks realistic because of sharp facets
    ctx.fillStyle = '#9a7850';
    ctx.beginPath();
    ctx.moveTo(-18, 0); ctx.lineTo(-10, -14); ctx.lineTo(0, -18);
    ctx.lineTo(12, -11); ctx.lineTo(20, 0);
    ctx.closePath(); ctx.fill();
    // Lit top facet
    ctx.fillStyle = '#c8a870';
    ctx.beginPath();
    ctx.moveTo(-10, -14); ctx.lineTo(0, -18); ctx.lineTo(5, -12); ctx.lineTo(-4, -10);
    ctx.closePath(); ctx.fill();
    // Shadow side facet
    ctx.fillStyle = '#6a4828';
    ctx.beginPath();
    ctx.moveTo(12, -11); ctx.lineTo(20, 0); ctx.lineTo(10, 0); ctx.lineTo(8, -8);
    ctx.closePath(); ctx.fill();
  }

  _drawCactusSilhouette(ctx) {
    // Dark silhouette saguaro — no cartoon green, just a dark outline shape
    // Looks distant and realistic
    ctx.fillStyle = '#2a3820';
    // Trunk
    ctx.beginPath(); ctx.rect(-6, -80, 12, 80); ctx.fill();
    // Left arm
    ctx.beginPath();
    ctx.moveTo(-6, -55); ctx.lineTo(-28, -55); ctx.lineTo(-28, -38); ctx.lineTo(-6, -38);
    ctx.fill();
    ctx.beginPath(); ctx.rect(-34, -62, 12, 24); ctx.fill();
    // Right arm
    ctx.beginPath();
    ctx.moveTo(6, -45); ctx.lineTo(22, -45); ctx.lineTo(22, -30); ctx.lineTo(6, -30);
    ctx.fill();
    ctx.beginPath(); ctx.rect(16, -52, 12, 22); ctx.fill();
    // Top cap
    ctx.beginPath();
    ctx.ellipse(0, -80, 6, 4, 0, 0, Math.PI*2); ctx.fill();
  }

  _drawRockCluster(ctx) {
    // Group of 3 angular rocks at different sizes
    ctx.save(); ctx.translate(-18, 0); ctx.scale(0.7, 0.7); this._drawRock(ctx); ctx.restore();
    ctx.save(); ctx.translate(5, 0);   ctx.scale(1.0, 1.0); this._drawRock(ctx); ctx.restore();
    ctx.save(); ctx.translate(26, 4);  ctx.scale(0.5, 0.5); this._drawRock(ctx); ctx.restore();
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
