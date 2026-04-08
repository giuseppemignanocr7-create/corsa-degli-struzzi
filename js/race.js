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

    const laneCount  = CONFIG.NUM_OSTRICHES;
    const groundTop  = this.canvas.height * 0.63; // where ground starts
    const groundBot  = this.canvas.height * 0.93; // bottom margin
    const usableH    = groundBot - groundTop;
    const laneStep   = usableH / laneCount;

    OSTRICH_DATA.forEach((data, idx) => {
      // laneY = foot contact point, centered in each lane slot
      const laneY = groundTop + laneStep * idx + laneStep * 0.55;
      this.ostriches.push(new Ostrich(data, laneY));
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
    this._drawStands(W, H);
    this._drawDistantDunes(W, H);
    this._drawMidDunes(W, H);
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
    const skyH = H * 0.575; // sky ends at stand base
    const t    = this.elapsed / 1000;

    // ── Gradient: deep midnight-blue top → rich amber horizon ──
    const grad = ctx.createLinearGradient(0, 0, 0, skyH);
    grad.addColorStop(0,    '#06091a');
    grad.addColorStop(0.12, '#0d1b38');
    grad.addColorStop(0.30, '#1a2a5a');
    grad.addColorStop(0.55, '#b84010');
    grad.addColorStop(0.78, '#e86818');
    grad.addColorStop(1,    '#f5aa30');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, skyH);

    // ── Sunset crepuscular rays fanning from horizon ──
    const rayOriginX = W * 0.62;
    const rayOriginY = skyH * 0.95;
    ctx.save();
    for (let r = 0; r < 12; r++) {
      const angle = -Math.PI * 0.5 - 0.55 + r * (Math.PI * 0.12);
      const rayLen = skyH * 1.1;
      const x2 = rayOriginX + Math.cos(angle) * rayLen;
      const y2 = rayOriginY + Math.sin(angle) * rayLen;
      const rayGrad = ctx.createLinearGradient(rayOriginX, rayOriginY, x2, y2);
      rayGrad.addColorStop(0,   'rgba(255,180,60,0.07)');
      rayGrad.addColorStop(0.5, 'rgba(255,140,30,0.04)');
      rayGrad.addColorStop(1,   'rgba(255,100,0,0)');
      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(rayOriginX, rayOriginY);
      const spread = 0.04;
      ctx.lineTo(
        rayOriginX + Math.cos(angle - spread) * rayLen,
        rayOriginY + Math.sin(angle - spread) * rayLen
      );
      ctx.lineTo(
        rayOriginX + Math.cos(angle + spread) * rayLen,
        rayOriginY + Math.sin(angle + spread) * rayLen
      );
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // ── Stars: visible in top 40% ──
    if (!this._stars) {
      this._stars = [];
      for (let i = 0; i < 180; i++) {
        this._stars.push({
          x:       Math.random(),
          y:       Math.random() * 0.38,
          r:       0.4 + Math.random() * 1.4,
          twinkle: Math.random() * Math.PI * 2,
          speed:   0.8 + Math.random() * 1.2,
        });
      }
    }
    this._stars.forEach(s => {
      const alpha = Math.max(0, 0.25 + Math.sin(t * s.speed + s.twinkle) * 0.3);
      ctx.fillStyle = `rgba(255,255,245,${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * skyH, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Sun position (parallax, drifts right as camera moves) ──
    const sunScroll = this.cameraX * 0.04;
    const sunX = ((W * 0.68 - sunScroll % W) + W * 2) % W;
    const sunY = skyH * 0.82;
    const sunR = 48;

    // Outer glow
    const coronaOuter = ctx.createRadialGradient(sunX, sunY, sunR, sunX, sunY, sunR * 5);
    coronaOuter.addColorStop(0,   'rgba(255,200,60,0.28)');
    coronaOuter.addColorStop(0.35,'rgba(255,140,20,0.12)');
    coronaOuter.addColorStop(1,   'rgba(255,80,0,0)');
    ctx.fillStyle = coronaOuter;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 5, 0, Math.PI * 2);
    ctx.fill();

    // Inner halo
    const coronaInner = ctx.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 1.8);
    coronaInner.addColorStop(0,   'rgba(255,240,140,0.5)');
    coronaInner.addColorStop(1,   'rgba(255,180,40,0)');
    ctx.fillStyle = coronaInner;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Sun disc
    const sunDisc = ctx.createRadialGradient(sunX - sunR * 0.3, sunY - sunR * 0.3, 0, sunX, sunY, sunR);
    sunDisc.addColorStop(0,   '#fffce0');
    sunDisc.addColorStop(0.45,'#ffe860');
    sunDisc.addColorStop(0.8, '#ffb020');
    sunDisc.addColorStop(1,   '#ff7800');
    ctx.fillStyle = sunDisc;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // ── Volumetric clouds: multi-puff style ──
    if (!this._clouds) {
      this._clouds = [];
      for (let i = 0; i < 14; i++) {
        const puffCount = 3 + Math.floor(Math.random() * 5);
        const puffs = [];
        for (let p = 0; p < puffCount; p++) {
          puffs.push({
            ox: (Math.random() - 0.3) * 180,
            oy: (Math.random() - 0.5) * 30,
            r:  28 + Math.random() * 55,
          });
        }
        this._clouds.push({
          worldX: Math.random() * CONFIG.TRACK_LENGTH * 1.3,
          yFrac:  0.04 + Math.random() * 0.55,
          puffs,
          alpha:  0.10 + Math.random() * 0.18,
          speed:  0.012 + Math.random() * 0.018, // drift speed
          drift:  Math.random() * 1000,
        });
      }
    }
    this._clouds.forEach(c => {
      const cx = (c.worldX + t * c.speed * 60 - this.cameraX * 0.04) % (W * 1.8);
      const cy = skyH * c.yFrac;
      // Tint: high clouds are blue-white, low are amber
      const lowness = c.yFrac;  // 0=top, 1=horizon
      const rr = Math.floor(220 + lowness * 35);
      const gg = Math.floor(180 + lowness * 20);
      const bb = Math.floor(220 - lowness * 140);

      c.puffs.forEach(p => {
        const pg = ctx.createRadialGradient(cx + p.ox, cy + p.oy - p.r * 0.2, 0, cx + p.ox, cy + p.oy, p.r);
        pg.addColorStop(0,   `rgba(${rr},${gg},${bb},${c.alpha})`);
        pg.addColorStop(0.6, `rgba(${rr-20},${gg-20},${bb-40},${c.alpha * 0.55})`);
        pg.addColorStop(1,   `rgba(${rr-40},${gg-40},${bb-80},0)`);
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(cx + p.ox, cy + p.oy, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // ── Horizon atmospheric haze ──
    const hazeGrad = ctx.createLinearGradient(0, skyH * 0.78, 0, skyH);
    hazeGrad.addColorStop(0,   'rgba(255,160,60,0)');
    hazeGrad.addColorStop(0.5, 'rgba(255,180,80,0.14)');
    hazeGrad.addColorStop(1,   'rgba(255,200,100,0.28)');
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, skyH * 0.78, W, skyH * 0.22);
  }

  _drawDistantDunes(W, H) {
    const ctx    = this.ctx;
    const scroll = (this.cameraX * CONFIG.PARALLAX[1]) % W;
    const base   = H * 0.575; // align to stand horizon

    // Atmospheric haze overlay — makes far dunes look hazy/distant
    const hazeLayer = ctx.createLinearGradient(0, base * 0.62, 0, base);
    hazeLayer.addColorStop(0,   'rgba(140,100,60,0)');
    hazeLayer.addColorStop(1,   'rgba(180,120,60,0.22)');

    // Dark shadow silhouette (furthest, most faded)
    const shadowColor = 'rgba(90,45,18,0.75)';
    ctx.fillStyle = shadowColor;
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * W - scroll;
      ctx.beginPath();
      ctx.moveTo(ox,          base);
      ctx.bezierCurveTo(ox + W*0.12, base*0.67, ox + W*0.25, base*0.73, ox + W*0.38, base*0.88);
      ctx.bezierCurveTo(ox + W*0.50, base*0.71, ox + W*0.62, base*0.60, ox + W*0.73, base*0.78);
      ctx.bezierCurveTo(ox + W*0.83, base*0.66, ox + W*0.91, base*0.75, ox + W,      base);
      ctx.closePath();
      ctx.fill();
    }

    // Main dune silhouette — 3-stop gradient for depth
    const dg = ctx.createLinearGradient(0, base * 0.55, 0, base);
    dg.addColorStop(0,   '#7a3c18');
    dg.addColorStop(0.5, '#a05828');
    dg.addColorStop(1,   '#c07838');
    ctx.fillStyle = dg;
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * W - scroll;
      ctx.beginPath();
      ctx.moveTo(ox,          base);
      ctx.bezierCurveTo(ox + W*0.15, base*0.62, ox + W*0.28, base*0.69, ox + W*0.4,  base*0.87);
      ctx.bezierCurveTo(ox + W*0.52, base*0.69, ox + W*0.65, base*0.58, ox + W*0.75, base*0.77);
      ctx.bezierCurveTo(ox + W*0.85, base*0.63, ox + W*0.92, base*0.72, ox + W,      base);
      ctx.closePath();
      ctx.fill();
    }

    // Sunlit ridge highlight
    ctx.strokeStyle = 'rgba(255,190,90,0.18)';
    ctx.lineWidth = 2.5;
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * W - scroll;
      ctx.beginPath();
      ctx.moveTo(ox + W*0.15, base*0.62);
      ctx.bezierCurveTo(ox + W*0.28, base*0.69, ox + W*0.4, base*0.87, ox + W*0.52, base*0.69);
      ctx.bezierCurveTo(ox + W*0.65, base*0.58, ox + W*0.75, base*0.77, ox + W*0.85, base*0.63);
      ctx.stroke();
    }

    // Atmospheric haze on top of distant dunes
    ctx.fillStyle = hazeLayer;
    ctx.fillRect(0, base * 0.55, W, base * 0.45);
  }

  _drawMidDunes(W, H) {
    const ctx    = this.ctx;
    const scroll = (this.cameraX * CONFIG.PARALLAX[2]) % W;
    const base   = H * 0.63; // ground starts here
    const top    = H * 0.575;

    // Dark shadow base
    ctx.fillStyle = 'rgba(100,55,18,0.9)';
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * W - scroll;
      ctx.beginPath();
      ctx.moveTo(ox,          base);
      ctx.bezierCurveTo(ox + W*0.10, base*0.83, ox + W*0.22, base*0.89, ox + W*0.35, base*0.97);
      ctx.bezierCurveTo(ox + W*0.48, base*0.83, ox + W*0.58, base*0.78, ox + W*0.70, base*0.92);
      ctx.bezierCurveTo(ox + W*0.82, base*0.80, ox + W*0.90, base*0.86, ox + W,      base);
      ctx.closePath();
      ctx.fill();
    }

    // Main mid-dune — warm golden sand
    const mg = ctx.createLinearGradient(0, top, 0, base);
    mg.addColorStop(0,   '#dba060');
    mg.addColorStop(0.4, '#c88840');
    mg.addColorStop(1,   '#b06828');
    ctx.fillStyle = mg;
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * W - scroll;
      ctx.beginPath();
      ctx.moveTo(ox,          base);
      ctx.bezierCurveTo(ox + W*0.10, base*0.80, ox + W*0.22, base*0.87, ox + W*0.35, base*0.95);
      ctx.bezierCurveTo(ox + W*0.48, base*0.80, ox + W*0.58, base*0.74, ox + W*0.70, base*0.89);
      ctx.bezierCurveTo(ox + W*0.82, base*0.76, ox + W*0.90, base*0.83, ox + W,      base);
      ctx.closePath();
      ctx.fill();
    }

    // Bright sunlit ridge
    ctx.strokeStyle = 'rgba(255,220,130,0.30)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * W - scroll;
      ctx.beginPath();
      ctx.moveTo(ox + W*0.10, base*0.80);
      ctx.bezierCurveTo(ox + W*0.22, base*0.87, ox + W*0.35, base*0.95, ox + W*0.48, base*0.80);
      ctx.bezierCurveTo(ox + W*0.58, base*0.74, ox + W*0.70, base*0.89, ox + W*0.82, base*0.76);
      ctx.stroke();
    }

    // Secondary specular highlight (thinner, brighter)
    ctx.strokeStyle = 'rgba(255,240,180,0.15)';
    ctx.lineWidth = 1.5;
    for (let rep = -1; rep <= 1; rep++) {
      const ox = rep * W - scroll;
      ctx.beginPath();
      ctx.moveTo(ox + W*0.10, base*0.795);
      ctx.bezierCurveTo(ox + W*0.22, base*0.865, ox + W*0.35, base*0.945, ox + W*0.48, base*0.795);
      ctx.bezierCurveTo(ox + W*0.58, base*0.735, ox + W*0.70, base*0.885, ox + W*0.82, base*0.755);
      ctx.stroke();
    }
  }

  _drawGround(W, H) {
    const ctx = this.ctx;
    const groundY = H * 0.63;

    // Base sand gradient
    const grad = ctx.createLinearGradient(0, groundY, 0, H);
    grad.addColorStop(0,    '#f0b050');
    grad.addColorStop(0.15, '#e09840');
    grad.addColorStop(0.5,  '#c87830');
    grad.addColorStop(1,    '#a05e20');
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY, W, H - groundY);

    // Sand texture: subtle ripple lines
    ctx.strokeStyle = 'rgba(255,200,100,0.06)';
    ctx.lineWidth = 1;
    const rippleScroll = (this.cameraX * 0.4) % 40;
    for (let rx = -40; rx < W + 40; rx += 40) {
      const x = rx - rippleScroll;
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + 20, H);
      ctx.stroke();
    }

    // Near-ground lighter strip
    const nearGrad = ctx.createLinearGradient(0, groundY, 0, groundY + H * 0.04);
    nearGrad.addColorStop(0, 'rgba(255,220,120,0.35)');
    nearGrad.addColorStop(1, 'rgba(255,220,120,0)');
    ctx.fillStyle = nearGrad;
    ctx.fillRect(0, groundY, W, H * 0.04);

    // Lane dividers — subtle dashed lines
    const laneCount = CONFIG.NUM_OSTRICHES;
    const groundBot = H * 0.93;
    const usableH   = groundBot - groundY;
    const laneStep  = usableH / laneCount;
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    ctx.setLineDash([18, 14]);
    for (let i = 1; i < laneCount; i++) {
      const y = groundY + laneStep * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Hard border at top of ground
    ctx.strokeStyle = 'rgba(180,100,30,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();
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

  // ─── STADIUM GRANDSTANDS ───────────────────────
  _drawStands(W, H) {
    const ctx  = this.ctx;
    const t    = this.elapsed / 1000;

    // The stands sit in the sky zone: from ~H*0.04 down to ~H*0.56 (horizon)
    // We draw them as a continuous strip that parallax-scrolls slowly
    const standBaseY  = H * 0.575;   // bottom edge of stands = horizon line
    const standTopY   = H * 0.04;    // top of highest tier
    const standH      = standBaseY - standTopY;
    const numTiers    = 7;            // rows of seating
    const tierH       = standH / numTiers;

    // How wide one "section" repeating unit is
    const sectionW    = 320;
    const scroll      = (this.cameraX * 0.08) % sectionW; // very slow parallax

    // Pre-generate stand fan/crowd data once (fixed pool of 60 sections)
    if (!this._standSections) {
      this._standSections = [];
      for (let s = 0; s < 60; s++) {
        const fans = [];
        for (let tier = 0; tier < numTiers; tier++) {
          const fansInRow = Math.floor(sectionW / 14);
          for (let f = 0; f < fansInRow; f++) {
            const hue = Math.floor(Math.random() * 360);
            fans.push({
              tier,
              col: f,
              hue,
              saturation: 55 + Math.random() * 35,
              lightness:  48 + Math.random() * 22,
              bobOffset:  Math.random() * Math.PI * 2,
              armPhase:   Math.random() * Math.PI * 2,
              waving:     Math.random() > 0.45,
              hasFlag:    Math.random() > 0.78,
              flagHue:    Math.floor(Math.random() * 360),
            });
          }
        }
        this._standSections.push({ fans });
      }

      // Floodlight pylons: fixed world positions every ~800 units
      this._pylons = [];
      const pylonCount = Math.ceil(CONFIG.TRACK_LENGTH / 800) + 2;
      for (let i = 0; i < pylonCount; i++) {
        this._pylons.push({ worldX: 400 + i * 800 + Math.random() * 80 });
      }
    }

    // ── 1. Concrete stand backdrop ──────────────────
    const backdropGrad = ctx.createLinearGradient(0, standTopY, 0, standBaseY);
    backdropGrad.addColorStop(0,   '#1a1a2e');
    backdropGrad.addColorStop(0.3, '#16213e');
    backdropGrad.addColorStop(0.7, '#0f3460');
    backdropGrad.addColorStop(1,   '#1a3050');
    ctx.fillStyle = backdropGrad;
    ctx.fillRect(0, standTopY, W, standH);

    // ── 2. Tier steps (concrete edges) ──────────────
    for (let tier = 0; tier < numTiers; tier++) {
      const ty = standTopY + tierH * (tier + 1);
      // Concrete step shadow
      const stepGrad = ctx.createLinearGradient(0, ty - 4, 0, ty + 6);
      stepGrad.addColorStop(0, 'rgba(0,0,0,0.5)');
      stepGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = stepGrad;
      ctx.fillRect(0, ty - 4, W, 10);

      // Concrete edge highlight
      ctx.strokeStyle = 'rgba(180,180,220,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, ty);
      ctx.lineTo(W, ty);
      ctx.stroke();
    }

    // ── 3. Vertical section dividers ────────────────
    for (let sx = -scroll; sx < W + sectionW; sx += sectionW) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, standTopY);
      ctx.lineTo(sx, standBaseY);
      ctx.stroke();
    }

    // ── 4. Draw fans in seats ───────────────────────
    const totalSections = Math.ceil(W / sectionW) + 3;
    const firstSec = Math.floor(scroll / sectionW);

    for (let si = 0; si < totalSections; si++) {
      const secIdx   = ((firstSec + si) % this._standSections.length + this._standSections.length) % this._standSections.length;
      const sec      = this._standSections[secIdx];
      const secLeft  = si * sectionW - (scroll % sectionW);

      sec.fans.forEach(fan => {
        const tierTop  = standTopY + tierH * fan.tier;
        const tierMid  = tierTop + tierH * 0.38;
        const fx       = secLeft + fan.col * 14 + 7;
        const headR    = Math.max(2, tierH * 0.16);
        const bob      = fan.waving ? Math.sin(t * 2.2 + fan.bobOffset) * headR * 0.9 : Math.sin(t * 0.8 + fan.bobOffset) * headR * 0.3;

        // Seat (coloured plastic bucket seat)
        const seatH = tierH * 0.35;
        ctx.fillStyle = `hsl(${fan.hue},${fan.saturation}%,25%)`;
        ctx.beginPath();
        ctx.roundRect(fx - headR * 0.9, tierMid + headR * 1.4, headR * 1.8, seatH, 2);
        ctx.fill();

        // Body
        ctx.fillStyle = `hsl(${fan.hue},${fan.saturation}%,${fan.lightness - 12}%)`;
        ctx.beginPath();
        ctx.ellipse(fx, tierMid + headR * 1.1, headR * 0.85, headR * 1.1, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        const skinTones = ['#f5c5a0','#e8a870','#c87840','#8b5e3c','#5c3520'];
        ctx.fillStyle = skinTones[Math.abs(fan.col * 7 + fan.tier * 3) % skinTones.length];
        ctx.beginPath();
        ctx.arc(fx, tierMid + bob, headR, 0, Math.PI * 2);
        ctx.fill();

        // Waving arm
        if (fan.waving) {
          const armAngle = -1.1 + Math.sin(t * 2.8 + fan.armPhase) * 0.7;
          ctx.strokeStyle = `hsl(${fan.hue},${fan.saturation}%,${fan.lightness}%)`;
          ctx.lineWidth = Math.max(1, headR * 0.55);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(fx + headR * 0.7, tierMid + headR * 0.9 + bob);
          ctx.lineTo(
            fx + headR * 0.7 + Math.cos(armAngle) * headR * 2.2,
            tierMid + headR * 0.9 + bob + Math.sin(armAngle) * headR * 2.2
          );
          ctx.stroke();
        }

        // Flag
        if (fan.hasFlag) {
          const flagX = fx;
          const flagY = tierMid - headR * 1.2 + bob;
          // Pole
          ctx.strokeStyle = 'rgba(200,200,200,0.8)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(flagX, flagY);
          ctx.lineTo(flagX, flagY - headR * 4);
          ctx.stroke();
          // Flag cloth
          const wave = Math.sin(t * 3.5 + fan.bobOffset) * headR * 0.8;
          ctx.fillStyle = `hsl(${fan.flagHue},80%,55%)`;
          ctx.beginPath();
          ctx.moveTo(flagX, flagY - headR * 4);
          ctx.quadraticCurveTo(flagX + headR * 2 + wave, flagY - headR * 3.2, flagX + headR * 2.2 + wave, flagY - headR * 2.4);
          ctx.lineTo(flagX, flagY - headR * 2.4);
          ctx.closePath();
          ctx.fill();
        }
      });
    }

    // ── 5. Horizontal banner strips between tiers ───
    const bannerColors = ['#e74c3c','#f39c12','#2ecc71','#3498db','#9b59b6','#1abc9c'];
    for (let tier = 1; tier < numTiers; tier += 2) {
      const by = standTopY + tierH * tier - 3;
      ctx.fillStyle = bannerColors[tier % bannerColors.length];
      ctx.globalAlpha = 0.22;
      ctx.fillRect(0, by, W, 6);
      ctx.globalAlpha = 1;
    }

    // ── 6. Floodlight pylons ─────────────────────────
    this._pylons.forEach(p => {
      const px = p.worldX - this.cameraX * 0.08;
      if (px < -60 || px > W + 60) return;
      const pBase = standBaseY;
      const pTop  = standTopY - H * 0.06;
      const pW    = 8;

      // Pylon shaft
      const pylGrad = ctx.createLinearGradient(px - pW / 2, 0, px + pW / 2, 0);
      pylGrad.addColorStop(0, '#555');
      pylGrad.addColorStop(0.5, '#aaa');
      pylGrad.addColorStop(1, '#555');
      ctx.fillStyle = pylGrad;
      ctx.fillRect(px - pW / 2, pTop, pW, pBase - pTop);

      // Cross arm
      ctx.fillStyle = '#888';
      ctx.fillRect(px - 30, pTop + 8, 60, 5);

      // Lamp fixtures
      [-24, -10, 6, 20].forEach(lx => {
        const lg = ctx.createRadialGradient(px + lx, pTop + 10, 0, px + lx, pTop + 10, 14);
        lg.addColorStop(0,   'rgba(255,255,180,0.95)');
        lg.addColorStop(0.4, 'rgba(255,240,120,0.5)');
        lg.addColorStop(1,   'rgba(255,220,80,0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(px + lx, pTop + 10, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffcc';
        ctx.beginPath();
        ctx.ellipse(px + lx, pTop + 10, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      // Cone of light downward
      const coneGrad = ctx.createLinearGradient(px, pTop + 14, px, standBaseY);
      coneGrad.addColorStop(0, 'rgba(255,255,180,0.06)');
      coneGrad.addColorStop(1, 'rgba(255,255,180,0)');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(px - 28, pTop + 14);
      ctx.lineTo(px + 28, pTop + 14);
      ctx.lineTo(px + 80, standBaseY);
      ctx.lineTo(px - 80, standBaseY);
      ctx.closePath();
      ctx.fill();
    });

    // ── 7. Overlay gradient to blend stands into horizon ──
    const blendGrad = ctx.createLinearGradient(0, standBaseY - H * 0.08, 0, standBaseY);
    blendGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blendGrad.addColorStop(1, 'rgba(20,10,5,0.55)');
    ctx.fillStyle = blendGrad;
    ctx.fillRect(0, standBaseY - H * 0.08, W, H * 0.08);

    // ── 8. Track-side barrier / advertising hoardings ──
    const barrierY = standBaseY;
    const barrierH = H * 0.025;
    const adColors = ['#e74c3c','#f39c12','#3498db','#27ae60','#8e44ad','#e67e22'];
    const adW = 90;
    const adScroll = (this.cameraX * 0.95) % adW;
    for (let ax = -adScroll; ax < W + adW; ax += adW) {
      const ci = Math.floor((ax + adScroll) / adW) % adColors.length;
      ctx.fillStyle = adColors[((ci % adColors.length) + adColors.length) % adColors.length];
      ctx.fillRect(ax, barrierY, adW - 2, barrierH);
      // White text placeholder stripe
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(ax + 8, barrierY + barrierH * 0.3, adW - 18, barrierH * 0.4);
    }
    // Barrier top edge
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, barrierY);
    ctx.lineTo(W, barrierY);
    ctx.stroke();
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
