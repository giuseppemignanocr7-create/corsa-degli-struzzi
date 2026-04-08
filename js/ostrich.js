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

    // Only draw if on screen
    if (screenX < -220 || screenX > ctx.canvas.width + 220) return;

    const groundY = this.laneY;
    const scale   = 1.55; // max size

    // Burst flame trail — larger, more cinematic
    if (this.isBursting) {
      ctx.save();
      for (let i = 0; i < 8; i++) {
        const fx    = screenX - 30 - i * 16;
        const fy    = groundY - 50 - Math.random() * 28;
        const alpha = (1 - i / 8) * 0.8;
        const r     = (8 - i) * 3.5;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = i < 2 ? '#fff5a0' : i < 4 ? '#f1c40f' : '#e67e22';
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(screenX, groundY);
    ctx.scale(scale, scale);

    // --- Shadow (elongated, softer) ---
    ctx.save();
    ctx.globalAlpha = 0.22;
    const sGrad = ctx.createRadialGradient(32, 12, 0, 32, 12, 52);
    sGrad.addColorStop(0,   'rgba(0,0,0,0.7)');
    sGrad.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = sGrad;
    ctx.beginPath();
    ctx.ellipse(32, 12, 52, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- Legs (4 legs, paired) ---
    this._drawLegs(ctx);

    // --- Body ---
    this._drawBody(ctx, isPlayer);

    // --- Neck & Head ---
    this._drawNeckHead(ctx);

    // --- Jockey ---
    this._drawJockey(ctx);

    // --- Number badge ---
    this._drawBadge(ctx, isPlayer);

    ctx.restore();
  }

  _drawLegs(ctx) {
    const legColor  = '#c4a882';
    const shinColor = '#a08868';
    const footColor = '#6a5038';

    const legs = [
      { ox: 20, phase: 0 },
      { ox: 38, phase: Math.PI },
    ];

    legs.forEach(leg => {
      const s     = Math.sin(this.stridePhase + leg.phase);
      const lift  = Math.max(0, s) * 10;  // foot lifts when forward

      // Thigh: hip to knee
      const kneeX = leg.ox + s * 16;
      const kneeY = -16 + Math.abs(s) * -5;
      ctx.strokeStyle = legColor;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(leg.ox, -22);
      ctx.lineTo(kneeX, kneeY);
      ctx.stroke();

      // Shin: knee to foot
      const footX = kneeX + s * 10;
      const footY = 8 - lift;
      ctx.strokeStyle = shinColor;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(kneeX, kneeY);
      ctx.lineTo(footX, footY);
      ctx.stroke();

      // Knee joint dot
      ctx.fillStyle = legColor;
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Foot / claw
      ctx.strokeStyle = footColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(footX, footY);
      ctx.lineTo(footX + 10, footY + 5);
      ctx.moveTo(footX, footY);
      ctx.lineTo(footX + 2, footY + 7);
      ctx.moveTo(footX, footY);
      ctx.lineTo(footX - 4, footY + 6);
      ctx.stroke();
    });
  }

  _drawBody(ctx, isPlayer) {
    // Main body — radial gradient with sheen
    const grad = ctx.createRadialGradient(18, -52, 4, 25, -42, 46);
    grad.addColorStop(0,   this._lighten(this.color, 55));
    grad.addColorStop(0.5, this.color);
    grad.addColorStop(1,   this._darken(this.color, 30));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(25, -42, 40, 30, -0.15, 0, Math.PI * 2);
    ctx.fill();

    // Specular sheen
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.ellipse(14, -56, 16, 9, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Wing feather texture — 3 arcs
    for (let i = 0; i < 3; i++) {
      const wx = 4 - i * 6;
      const wy = -36 - i * 4;
      ctx.strokeStyle = this._darken(this.color, 28 + i * 8);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(wx, wy, 16 - i * 2, 7, 0.5, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    }

    // Player highlight ring — glowing gold
    if (isPlayer) {
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#f1c40f';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(25, -42, 44, 34, -0.15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  _drawNeckHead(ctx) {
    const neckSway = Math.sin(this.neckPhase) * 5;
    const neckBob  = Math.abs(Math.sin(this.stridePhase)) * -4;
    const neckColor = '#c8a070';

    // Neck — thick tapered line
    ctx.lineCap = 'round';
    ctx.strokeStyle = neckColor;
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(54, -56);
    ctx.quadraticCurveTo(62 + neckSway, -80 + neckBob, 67 + neckSway, -98 + neckBob);
    ctx.stroke();
    // Neck shading
    ctx.strokeStyle = this._darken(neckColor, 20);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(58, -56);
    ctx.quadraticCurveTo(66 + neckSway, -80 + neckBob, 70 + neckSway, -98 + neckBob);
    ctx.stroke();

    // Head
    const hx = 68 + neckSway;
    const hy = -106 + neckBob;
    const hGrad = ctx.createRadialGradient(hx - 4, hy - 3, 1, hx, hy, 15);
    hGrad.addColorStop(0,   this._lighten(neckColor, 30));
    hGrad.addColorStop(1,   this._darken(neckColor, 15));
    ctx.fillStyle = hGrad;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 15, 11, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Eye with iris
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(74 + neckSway, -109 + neckBob, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a8a20';
    ctx.beginPath();
    ctx.arc(74 + neckSway, -109 + neckBob, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(75.5 + neckSway, -110 + neckBob, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Beak — two parts (upper/lower)
    ctx.fillStyle = '#e8b060';
    ctx.beginPath();
    ctx.moveTo(80 + neckSway, -108 + neckBob);
    ctx.lineTo(94 + neckSway, -106 + neckBob);
    ctx.lineTo(80 + neckSway, -104 + neckBob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c89040';
    ctx.beginPath();
    ctx.moveTo(80 + neckSway, -104 + neckBob);
    ctx.lineTo(92 + neckSway, -104 + neckBob);
    ctx.lineTo(80 + neckSway, -102 + neckBob);
    ctx.closePath();
    ctx.fill();

    // Head plume feathers
    ctx.strokeStyle = this._darken(neckColor, 10);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const fx = 58 + i * 3.5 + neckSway;
      const fBase = -114 + neckBob;
      ctx.beginPath();
      ctx.moveTo(fx, fBase);
      ctx.quadraticCurveTo(fx - 2 + i, fBase - 10, fx - 4 + i * 2, fBase - 16);
      ctx.stroke();
    }
  }

  _drawJockey(ctx) {
    const jX = 28;
    const jY = -75;
    const bobY = Math.sin(this.stridePhase) * 2; // jockey bounces with stride

    // Torso
    const jGrad = ctx.createLinearGradient(jX - 10, jY + bobY, jX + 12, jY + bobY);
    jGrad.addColorStop(0, this._lighten(this.jerseyColor, 20));
    jGrad.addColorStop(1, this._darken(this.jerseyColor, 20));
    ctx.fillStyle = jGrad;
    ctx.beginPath();
    ctx.ellipse(jX, jY + bobY, 11, 15, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Jersey stripe
    ctx.strokeStyle = this._lighten(this.jerseyColor, 50);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(jX - 8, jY - 4 + bobY);
    ctx.lineTo(jX + 10, jY - 4 + bobY);
    ctx.stroke();

    // Helmet
    ctx.fillStyle = this._darken(this.jerseyColor, 25);
    ctx.beginPath();
    ctx.arc(jX + 4, jY - 13 + bobY, 10, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = this._darken(this.jerseyColor, 10);
    ctx.fillRect(jX - 6, jY - 14 + bobY, 20, 4);

    // Visor
    ctx.fillStyle = 'rgba(80,160,255,0.35)';
    ctx.beginPath();
    ctx.arc(jX + 4, jY - 13 + bobY, 10, 0.1, Math.PI * 0.65);
    ctx.fill();

    // Arm / reins
    ctx.strokeStyle = '#c8a060';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(jX + 9, jY - 2 + bobY);
    ctx.quadraticCurveTo(jX + 24, jY - 14 + bobY, jX + 34, jY - 6 + bobY);
    ctx.stroke();

    // Whip
    ctx.strokeStyle = '#5a3010';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(jX + 24, jY - 14 + bobY);
    ctx.quadraticCurveTo(jX + 38, jY - 20 + bobY, jX + 44, jY - 8 + bobY);
    ctx.stroke();

    // Legs gripping
    ctx.strokeStyle = '#d4a870';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(jX - 6, jY + 8 + bobY);
    ctx.lineTo(jX - 14, jY + 24 + bobY);
    ctx.moveTo(jX + 6, jY + 8 + bobY);
    ctx.lineTo(jX + 14, jY + 24 + bobY);
    ctx.stroke();
  }

  _drawBadge(ctx, isPlayer) {
    const bX = 20;
    const bY = -55;

    ctx.fillStyle = isPlayer ? '#f1c40f' : 'rgba(0,0,0,0.6)';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bX, bY, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isPlayer ? '#000' : 'white';
    ctx.font = 'bold 13px Arial Black';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.id, bX, bY + 1);
  }

  _lighten(hex, amount) {
    return this._adjustColor(hex, amount);
  }
  _darken(hex, amount) {
    return this._adjustColor(hex, -amount);
  }
  _adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
    return `rgb(${r},${g},${b})`;
  }

  getScreenX(cameraX) {
    return this.worldX - cameraX;
  }
}
