// =============================================
//  CORSA DEGLI STRUZZI - Ostrich Entity
// =============================================

class Ostrich {
  constructor(data, laneY) {
    this.id          = data.id;
    this.name        = data.name;
    this.color       = data.color;
    this.jerseyColor = data.jerseyColor;
    this.baseSpeed   = data.baseSpeed;
    this.stamina     = data.stamina;
    this.luck        = data.luck;

    this.worldX      = 0;           // position in world units [0 - TRACK_LENGTH]
    this.laneY       = laneY;       // fixed Y on canvas
    this.progress    = 0;           // 0..1, derived from worldX / TRACK_LENGTH
    this.finished    = false;
    this.finishTime  = Infinity;
    this.finalPos    = 0;

    // Animation state
    this.stridePhase = Math.random() * Math.PI * 2;
    this.strideSpeed = 8 + Math.random() * 4;
    this.neckPhase   = Math.random() * Math.PI * 2;

    // Speed noise state (pseudo-Perlin via summed sines)
    this.noiseOffset = Math.random() * 1000;
    this.boostTimer  = 0;           // catch-up boost remaining (ms)
    this.currentSpeed = this.baseSpeed;
  }

  // Smooth noise via summed harmonics
  _noise(t) {
    return (
      Math.sin(t * 0.8  + this.noiseOffset) * 0.4 +
      Math.sin(t * 2.3  + this.noiseOffset * 1.3) * 0.3 +
      Math.sin(t * 5.1  + this.noiseOffset * 0.7) * 0.2 +
      Math.sin(t * 11.7 + this.noiseOffset * 2.1) * 0.1
    ); // range roughly [-1, 1]
  }

  update(dt, elapsed, raceDuration, leaderProgress, allOstriches) {
    if (this.finished) return;

    const t          = elapsed / 1000;
    const raceRatio  = elapsed / raceDuration;
    const dtSec      = dt / 1000;

    // ── 1. Base noise variability (±8 units/sec, smooth)
    const noiseVal = this._noise(t) * 8 * this.luck;

    // ── 2. Stamina: slightly drop speed in last 35% of race
    let staminaMult = 1.0;
    if (raceRatio > 0.65) {
      const fatigue = (raceRatio - 0.65) / 0.35;
      staminaMult = 1.0 - (1.0 - this.stamina) * fatigue * 0.28;
    }

    // ── 3. Drama / rubber-band: pull lagging ostriches back in
    const gapToLeader = leaderProgress - this.progress;
    let catchUpMult = 1.0;
    if (gapToLeader > CONFIG.DRAMA_GAP_THRESHOLD) {
      catchUpMult = 1.0 + (gapToLeader - CONFIG.DRAMA_GAP_THRESHOLD) * CONFIG.DRAMA_STRENGTH;
    }

    // ── 4. Random sprint burst (each ostrich independently)
    if (!this.burstTimer) this.burstTimer = 0;
    if (this.burstTimer > 0) {
      this.burstTimer -= dt;
    } else if (Math.random() < CONFIG.BURST_CHANCE) {
      this.burstTimer = CONFIG.BURST_DURATION_MIN +
        Math.random() * (CONFIG.BURST_DURATION_MAX - CONFIG.BURST_DURATION_MIN);
      this.burstSpeed = CONFIG.BURST_MAGNITUDE * (0.7 + Math.random() * 0.6);
      this.isBursting = true;
    } else {
      this.isBursting = false;
    }
    if (this.burstTimer <= 0) this.isBursting = false;
    const burstBonus = this.isBursting ? this.burstSpeed : 0;

    // ── 5. Slipstream: if directly behind another ostrich, get a small bonus
    let slipBonus = 1.0;
    if (allOstriches) {
      for (const other of allOstriches) {
        if (other.id === this.id || other.finished) continue;
        const gap = other.worldX - this.worldX;
        if (gap > 0 && gap < CONFIG.SLIP_DISTANCE) {
          slipBonus = 1.0 + CONFIG.SLIP_BONUS * (1 - gap / CONFIG.SLIP_DISTANCE);
          break;
        }
      }
    }

    // ── 6. Final sprint (last 8%)
    const sprintMult = raceRatio > 0.92
      ? 1.0 + (raceRatio - 0.92) * 2.5
      : 1.0;

    // ── 7. Compute target speed then smooth with momentum
    const targetSpeed = (this.baseSpeed + noiseVal + burstBonus)
      * staminaMult * catchUpMult * slipBonus * sprintMult;
    const clampedTarget = Math.max(70, Math.min(targetSpeed, this.baseSpeed * 2.2));

    // Smooth: accelerate/decelerate toward target (momentum feel)
    const accel = clampedTarget > this.currentSpeed ? 180 : 120; // units/sec²
    if (this.currentSpeed < clampedTarget) {
      this.currentSpeed = Math.min(clampedTarget, this.currentSpeed + accel * dtSec);
    } else {
      this.currentSpeed = Math.max(clampedTarget, this.currentSpeed - accel * dtSec);
    }

    // ── 8. Advance world position
    this.worldX  += this.currentSpeed * dtSec;
    this.progress = Math.min(1, this.worldX / CONFIG.TRACK_LENGTH);

    if (this.progress >= 1 && !this.finished) {
      this.finished   = true;
      this.finishTime = elapsed;
    }

    // ── 9. Animate stride (speed proportional)
    const strideRate = 0.012 + (this.currentSpeed / this.baseSpeed) * 0.008;
    this.stridePhase += this.strideSpeed * dtSec * strideRate * 60;
    this.neckPhase   += 5 * dtSec;
  }

  // screenX = worldX converted to canvas pixels
  draw(ctx, cameraX, canvasHeight, isPlayer) {
    const screenX = this.worldX - cameraX;
    if (screenX < -300 || screenX > ctx.canvas.width + 300) return;

    const groundY = this.laneY;
    // Scale relative to canvas height for true responsive sizing
    const scale = canvasHeight * 0.00155;

    // ── Burst speed-lines behind ostrich ──
    if (this.isBursting) {
      ctx.save();
      for (let i = 0; i < 10; i++) {
        const fx    = screenX - (40 + i * 18) * scale;
        const fy    = groundY - (30 + Math.random() * 40) * scale;
        const alpha = (1 - i / 10) * 0.75;
        const r     = (10 - i) * 3.5 * scale;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = i < 2 ? '#fff8b0' : i < 5 ? '#f5c518' : '#e67e22';
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ── Ground shadow ──
    ctx.save();
    ctx.globalAlpha = 0.28;
    const shW = 70 * scale;
    const shH = 10 * scale;
    const shGrad = ctx.createRadialGradient(screenX + 10 * scale, groundY + 4 * scale, 0,
                                             screenX + 10 * scale, groundY + 4 * scale, shW);
    shGrad.addColorStop(0,   'rgba(0,0,0,0.55)');
    shGrad.addColorStop(0.5, 'rgba(0,0,0,0.2)');
    shGrad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = shGrad;
    ctx.beginPath();
    ctx.ellipse(screenX + 10 * scale, groundY + 5 * scale, shW, shH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(screenX, groundY);
    ctx.scale(scale, scale);

    this._drawLegs(ctx);
    this._drawBody(ctx, isPlayer);
    this._drawNeckHead(ctx);
    this._drawJockey(ctx);
    this._drawBadge(ctx, isPlayer);

    ctx.restore();
  }

  _drawLegs(ctx) {
    // Real ostrich anatomy: upper leg (femur, mostly hidden in body),
    // lower leg (tarsus = very long), foot + 2 toes
    // 2 legs, offset in phase by PI
    const pairs = [
      { hipX: 18, hipY: -14, phase: 0 },
      { hipX: 32, hipY: -14, phase: Math.PI },
    ];

    pairs.forEach(leg => {
      const s  = Math.sin(this.stridePhase + leg.phase);
      const s2 = Math.cos(this.stridePhase + leg.phase);

      // Upper leg (thigh) — short, thick, mostly under body
      const kneeX = leg.hipX + s * 22;
      const kneeY = leg.hipY + 26 + Math.abs(s) * 6;

      // Lower leg (long tarsus) — the characteristic long shin
      const ankleX = kneeX + s * 14;
      const ankleY = kneeY + 36 - Math.max(0, s) * 12;

      // Ground foot
      const footY = 0;
      const footX = ankleX + s2 * 6;
      const onGround = ankleY > -8;

      // Thigh shadow
      ctx.strokeStyle = this._darken('#c8aa80', 20);
      ctx.lineWidth = 11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(leg.hipX + 1, leg.hipY + 1);
      ctx.lineTo(kneeX + 1, kneeY + 1);
      ctx.stroke();

      // Thigh
      const thighGrad = ctx.createLinearGradient(leg.hipX - 6, leg.hipY, leg.hipX + 6, leg.hipY);
      thighGrad.addColorStop(0, '#d4b888');
      thighGrad.addColorStop(0.5, '#c8aa80');
      thighGrad.addColorStop(1, '#a88860');
      ctx.strokeStyle = thighGrad;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(leg.hipX, leg.hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.stroke();

      // Knee cap
      ctx.fillStyle = '#b89870';
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8aa80';
      ctx.beginPath();
      ctx.arc(kneeX - 1, kneeY - 1, 4, 0, Math.PI * 2);
      ctx.fill();

      // Lower leg (tarsus) shadow
      ctx.strokeStyle = this._darken('#b89060', 25);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(kneeX + 1, kneeY + 1);
      ctx.lineTo(ankleX + 1, onGround ? footY + 1 : ankleY + 1);
      ctx.stroke();

      // Lower leg (tarsus)
      ctx.strokeStyle = '#b89060';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(kneeX, kneeY);
      ctx.lineTo(ankleX, onGround ? footY : ankleY);
      ctx.stroke();

      // Ankle joint
      const ankleDrawY = onGround ? footY : ankleY;
      ctx.fillStyle = '#a07848';
      ctx.beginPath();
      ctx.arc(ankleX, ankleDrawY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Two toes (ostrich has 2 toes)
      ctx.strokeStyle = '#7a5830';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      const toeBend = onGround ? 0 : 8;
      // Main forward toe
      ctx.beginPath();
      ctx.moveTo(ankleX, ankleDrawY);
      ctx.quadraticCurveTo(ankleX + 10, ankleDrawY + toeBend, ankleX + 22, ankleDrawY + 4);
      ctx.stroke();
      // Rear small toe
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ankleX, ankleDrawY);
      ctx.lineTo(ankleX - 10, ankleDrawY + 3);
      ctx.stroke();
      // Claw tips
      ctx.strokeStyle = '#3a2010';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ankleX + 22, ankleDrawY + 4);
      ctx.lineTo(ankleX + 28, ankleDrawY + 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ankleX - 10, ankleDrawY + 3);
      ctx.lineTo(ankleX - 16, ankleDrawY + 1);
      ctx.stroke();
    });
  }

  _drawBody(ctx, isPlayer) {
    // Large, round body — main feather mass
    // Base body shape
    const bodyGrad = ctx.createRadialGradient(-2, -55, 5, 8, -48, 58);
    bodyGrad.addColorStop(0,   this._lighten(this.color, 60));
    bodyGrad.addColorStop(0.3, this._lighten(this.color, 25));
    bodyGrad.addColorStop(0.7, this.color);
    bodyGrad.addColorStop(1,   this._darken(this.color, 35));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(12, -50, 46, 40, -0.12, 0, Math.PI * 2);
    ctx.fill();

    // Tail feathers — fan of arcs at the back
    ctx.save();
    ctx.translate(-28, -48);
    for (let i = 0; i < 7; i++) {
      const angle = -0.6 + i * 0.22;
      const len   = 28 + (i % 2) * 8;
      const tx    = Math.cos(angle + Math.PI) * len;
      const ty    = Math.sin(angle + Math.PI) * len;
      ctx.strokeStyle = i % 2 === 0
        ? this._darken(this.color, 18)
        : this._darken(this.color, 8);
      ctx.lineWidth = 5 - (i % 2) * 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(tx * 0.5 + 4, ty * 0.5 - 6, tx, ty);
      ctx.stroke();
    }
    ctx.restore();

    // Wing feather layers — 5 overlapping curved arcs
    for (let i = 0; i < 5; i++) {
      const wy = -38 - i * 7;
      const wx = -18 + i * 4;
      const wingGrad = ctx.createLinearGradient(wx, wy - 5, wx + 36, wy + 10);
      wingGrad.addColorStop(0,   this._lighten(this.color, 10 - i * 3));
      wingGrad.addColorStop(1,   this._darken(this.color, 20 + i * 5));
      ctx.strokeStyle = wingGrad;
      ctx.lineWidth = 7 - i * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.ellipse(wx + 16, wy, 20 - i * 1.5, 8, 0.35, Math.PI * 0.08, Math.PI * 0.92);
      ctx.stroke();
      // Feather tip dots
      ctx.fillStyle = this._darken(this.color, 25 + i * 5);
      ctx.beginPath();
      ctx.arc(wx + 35 - i * 2, wy + 3, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body rim light (sun from the right)
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = 'rgba(255,220,120,1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(12, -50, 48, 42, -0.12, -0.4, 0.6);
    ctx.stroke();
    ctx.restore();

    // Top specular highlight
    ctx.save();
    ctx.globalAlpha = 0.20;
    const specGrad = ctx.createRadialGradient(6, -72, 0, 6, -72, 24);
    specGrad.addColorStop(0, 'rgba(255,255,255,1)');
    specGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = specGrad;
    ctx.beginPath();
    ctx.ellipse(6, -70, 20, 12, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Player gold ring
    if (isPlayer) {
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#f1c40f';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.ellipse(12, -50, 52, 46, -0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  _drawNeckHead(ctx) {
    const sway = Math.sin(this.neckPhase) * 6;
    const bob  = Math.abs(Math.sin(this.stridePhase)) * -5;

    // Neck base coords
    const nx0 = 46, ny0 = -68;       // base at body top
    const nx1 = 55 + sway * 0.4, ny1 = -100 + bob * 0.3;  // mid
    const nx2 = 60 + sway, ny2 = -130 + bob;              // top of neck

    // Neck shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 17;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(nx0 + 2, ny0 + 2);
    ctx.quadraticCurveTo(nx1 + 2, ny1 + 2, nx2 + 2, ny2 + 2);
    ctx.stroke();

    // Neck back side (darker)
    ctx.strokeStyle = this._darken('#c09060', 22);
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(nx0, ny0);
    ctx.quadraticCurveTo(nx1, ny1, nx2, ny2);
    ctx.stroke();

    // Neck main
    const nGrad = ctx.createLinearGradient(nx0 - 8, ny0, nx0 + 8, ny0);
    nGrad.addColorStop(0,   '#dab880');
    nGrad.addColorStop(0.45,'#c8a060');
    nGrad.addColorStop(1,   '#a07840');
    ctx.strokeStyle = nGrad;
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(nx0, ny0);
    ctx.quadraticCurveTo(nx1, ny1, nx2, ny2);
    ctx.stroke();

    // Neck feather texture (short cross-strokes)
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1.5;
    for (let n = 0; n < 5; n++) {
      const t   = n / 4;
      const cx  = nx0 + (nx2 - nx0) * t;
      const cy  = ny0 + (ny2 - ny0) * t;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy + 2);
      ctx.lineTo(cx + 7, cy - 2);
      ctx.stroke();
    }

    // ── HEAD ──
    const hx = nx2 + 5;
    const hy = ny2 - 12;

    // Head shadow
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.beginPath();
    ctx.ellipse(hx + 2, hy + 2, 20, 14, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Head base
    const hGrad = ctx.createRadialGradient(hx - 6, hy - 5, 1, hx, hy, 20);
    hGrad.addColorStop(0,   this._lighten('#c8a060', 40));
    hGrad.addColorStop(0.5, '#c8a060');
    hGrad.addColorStop(1,   this._darken('#c8a060', 25));
    ctx.fillStyle = hGrad;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 19, 13, 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Eye socket (darker)
    ctx.fillStyle = this._darken('#c8a060', 30);
    ctx.beginPath();
    ctx.arc(hx + 8, hy - 4, 7, 0, Math.PI * 2);
    ctx.fill();

    // Eye white sclera
    ctx.fillStyle = '#f8f0e0';
    ctx.beginPath();
    ctx.arc(hx + 8, hy - 4, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Iris
    ctx.fillStyle = '#2a6010';
    ctx.beginPath();
    ctx.arc(hx + 9, hy - 4, 3.8, 0, Math.PI * 2);
    ctx.fill();

    // Pupil
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.arc(hx + 9.5, hy - 4.5, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Eye catchlight
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(hx + 10.5, hy - 5.8, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // Eye ring
    ctx.strokeStyle = '#f0c840';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx + 8, hy - 4, 6, 0, Math.PI * 2);
    ctx.stroke();

    // Beak — wide flat bill, two halves
    const bx = hx + 17;
    const by = hy + 1;
    const beakOpen = Math.max(0, Math.sin(this.stridePhase * 1.3)) * 3;

    // Upper mandible
    ctx.fillStyle = '#e8b850';
    ctx.beginPath();
    ctx.moveTo(hx + 12, by - 4);
    ctx.quadraticCurveTo(bx + 4, by - 3 - beakOpen, bx + 14, by - 2 - beakOpen);
    ctx.quadraticCurveTo(bx + 4, by + 1, hx + 12, by);
    ctx.closePath();
    ctx.fill();

    // Lower mandible
    ctx.fillStyle = '#d0a030';
    ctx.beginPath();
    ctx.moveTo(hx + 12, by);
    ctx.quadraticCurveTo(bx + 4, by + 1, bx + 12, by + 2 + beakOpen);
    ctx.quadraticCurveTo(bx, by + 3, hx + 12, by + 3);
    ctx.closePath();
    ctx.fill();

    // Beak ridge line
    ctx.strokeStyle = '#b88820';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx + 12, by - 2);
    ctx.quadraticCurveTo(bx + 4, by - 1, bx + 13, by - 1 - beakOpen);
    ctx.stroke();

    // Head crest feathers
    ctx.strokeStyle = this._darken('#c8a060', 12);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let f = 0; f < 6; f++) {
      const fx = hx - 2 + f * 3.5;
      const fBase = hy - 11;
      const fH = 10 + (f % 2) * 6;
      ctx.beginPath();
      ctx.moveTo(fx, fBase);
      ctx.quadraticCurveTo(fx + f * 0.8 - 2, fBase - fH * 0.6, fx + f * 1.2 - 4, fBase - fH);
      ctx.stroke();
    }

    // Throat pouch (eyelid under beak)
    ctx.fillStyle = 'rgba(200,90,60,0.25)';
    ctx.beginPath();
    ctx.ellipse(hx + 6, hy + 8, 7, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawJockey(ctx) {
    // Jockey sits high on the ostrich back
    const jX  = 22;
    const jY  = -90;
    const bob = Math.sin(this.stridePhase) * 3;
    const lean = Math.sin(this.stridePhase * 0.5) * 4; // slight forward lean

    ctx.save();
    ctx.translate(jX, jY + bob);

    // ── Legs gripping ostrich body ──
    ctx.strokeStyle = this._darken(this.jerseyColor, 10);
    ctx.lineWidth   = 6;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, 14);
    ctx.quadraticCurveTo(-16, 22, -18, 32);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, 14);
    ctx.quadraticCurveTo(16, 22, 18, 32);
    ctx.stroke();
    // Boots
    ctx.fillStyle = '#3a2010';
    ctx.beginPath(); ctx.ellipse(-18, 33, 7, 4, 0.3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(18, 33, 7, 4, -0.3, 0, Math.PI*2); ctx.fill();

    // ── Torso ──
    const tGrad = ctx.createLinearGradient(-12, lean - 8, 12, lean + 12);
    tGrad.addColorStop(0, this._lighten(this.jerseyColor, 35));
    tGrad.addColorStop(0.5, this.jerseyColor);
    tGrad.addColorStop(1, this._darken(this.jerseyColor, 30));
    ctx.fillStyle = tGrad;
    ctx.save();
    ctx.rotate(lean * 0.04);
    ctx.beginPath();
    ctx.ellipse(0, 2, 12, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Jersey number/stripe
    ctx.strokeStyle = this._lighten(this.jerseyColor, 60);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-9, -3);
    ctx.lineTo(9, -3);
    ctx.stroke();
    ctx.restore();

    // ── Helmet ──
    ctx.save();
    ctx.rotate(lean * 0.04);

    // Helmet shell
    const helmGrad = ctx.createRadialGradient(-4, -27, 0, 0, -20, 14);
    helmGrad.addColorStop(0, this._lighten(this.jerseyColor, 50));
    helmGrad.addColorStop(0.6, this.jerseyColor);
    helmGrad.addColorStop(1, this._darken(this.jerseyColor, 30));
    ctx.fillStyle = helmGrad;
    ctx.beginPath();
    ctx.arc(0, -20, 13, Math.PI, 0);
    ctx.bezierCurveTo(13, -20, 14, -14, 10, -13);
    ctx.lineTo(-10, -13);
    ctx.bezierCurveTo(-14, -14, -13, -20, -13, -20);
    ctx.closePath();
    ctx.fill();

    // Helmet brim
    ctx.fillStyle = this._darken(this.jerseyColor, 25);
    ctx.fillRect(-14, -14, 28, 4);

    // Visor
    ctx.fillStyle = 'rgba(100,180,255,0.32)';
    ctx.beginPath();
    ctx.ellipse(3, -20, 11, 7, 0.15, 0.1, Math.PI * 0.7);
    ctx.fill();

    // Helmet highlight
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.ellipse(-3, -26, 5, 3, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Face (chin area)
    ctx.fillStyle = '#e8c090';
    ctx.beginPath();
    ctx.ellipse(2, -11, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Right arm / reins ──
    ctx.strokeStyle = '#c8a060';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(10, -4);
    ctx.quadraticCurveTo(22, -16, 32, -8);
    ctx.stroke();
    // Glove
    ctx.fillStyle = '#e8c060';
    ctx.beginPath();
    ctx.arc(32, -8, 4, 0, Math.PI * 2);
    ctx.fill();

    // ── Reins (to neck) ──
    ctx.strokeStyle = 'rgba(180,140,70,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(32, -8);
    ctx.quadraticCurveTo(40, -20, 36, -38);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Whip ──
    ctx.strokeStyle = '#4a2808';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(22, -16);
    ctx.quadraticCurveTo(36, -28, 44, -16);
    ctx.stroke();
    ctx.strokeStyle = '#8a5020';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(44, -16);
    ctx.quadraticCurveTo(50, -10, 48, -4);
    ctx.stroke();

    ctx.restore();
  }

  _drawBadge(ctx, isPlayer) {
    // Badge on body
    const bX = 12;
    const bY = -48;

    // Badge glow for player
    if (isPlayer) {
      ctx.shadowColor = '#f1c40f';
      ctx.shadowBlur  = 14;
    }

    ctx.fillStyle   = isPlayer ? '#f1c40f' : 'rgba(0,0,0,0.70)';
    ctx.strokeStyle = isPlayer ? '#fff' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.arc(bX, bY, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur  = 0;
    ctx.fillStyle   = isPlayer ? '#1a0a00' : 'white';
    ctx.font        = 'bold 12px Arial Black';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.id, bX, bY + 1);
  }

  _lighten(hex, amount) { return this._adjustColor(hex, amount); }
  _darken(hex, amount)  { return this._adjustColor(hex, -amount); }
  _adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#',''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
    return `rgb(${r},${g},${b})`;
  }

  getScreenX(cameraX) { return this.worldX - cameraX; }
}
