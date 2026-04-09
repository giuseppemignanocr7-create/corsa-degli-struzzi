// =============================================
//  CORSA DEGLI STRUZZI - Ostrich Entity
// =============================================

class Ostrich {
  constructor(data, laneY, laneStep) {
    this.id          = data.id;
    this.name        = data.name;
    this.color       = data.color;
    this.jerseyColor = data.jerseyColor;
    this.baseSpeed   = data.baseSpeed;
    this.stamina     = data.stamina;
    this.luck        = data.luck;

    this.worldX      = 0;           // position in world units [0 - TRACK_LENGTH]
    this.laneY       = laneY;       // foot contact Y on canvas
    // Scale so ostrich fills its height slot. Draw space: feet y=0, head crest y≈-175
    this.drawScale   = laneStep ? (laneStep / 175) : 1.0;
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
    const scale = this.drawScale;

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
    // Real ostrich leg anatomy: short hidden thigh, very long visible tarsus
    // Ostrich legs are pinkish-grey, not tan
    const pairs = [
      { hipX: 8,  phase: 0 },
      { hipX: 26, phase: Math.PI },
    ];

    pairs.forEach(leg => {
      const s = Math.sin(this.stridePhase + leg.phase);
      const hipY = -62;

      // Knee position
      const kneeX = leg.hipX + s * 20;
      const kneeY = hipY + 28 + Math.abs(s) * 5;

      // Ankle / tarsus end
      const ankleX = kneeX + s * 14;
      const ankleY = kneeY + 32 - Math.max(0, s) * 16;
      const onGround = ankleY >= -8;
      const drawAnkleY = onGround ? -2 : ankleY;

      // Shadow
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth   = 10;
      ctx.lineCap     = 'round';
      ctx.beginPath(); ctx.moveTo(leg.hipX+2, hipY+2); ctx.lineTo(kneeX+2, kneeY+2); ctx.stroke();
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(kneeX+2, kneeY+2); ctx.lineTo(ankleX+2, drawAnkleY+2); ctx.stroke();

      // Thigh (pinkish-grey, thick)
      const tg = ctx.createLinearGradient(leg.hipX-6, hipY, leg.hipX+6, hipY);
      tg.addColorStop(0, '#c8a898'); tg.addColorStop(0.5, '#b89080'); tg.addColorStop(1, '#907060');
      ctx.strokeStyle = tg;
      ctx.lineWidth   = 10;
      ctx.beginPath(); ctx.moveTo(leg.hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();

      // Knee cap
      ctx.fillStyle = '#a07868';
      ctx.beginPath(); ctx.arc(kneeX, kneeY, 6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#c09888';
      ctx.beginPath(); ctx.arc(kneeX-1, kneeY-1, 4, 0, Math.PI*2); ctx.fill();

      // Tarsus (long, thinner, same pinkish-grey)
      const tg2 = ctx.createLinearGradient(kneeX-5, kneeY, kneeX+5, kneeY);
      tg2.addColorStop(0, '#b89080'); tg2.addColorStop(1, '#806050');
      ctx.strokeStyle = tg2;
      ctx.lineWidth   = 7;
      ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(ankleX, drawAnkleY); ctx.stroke();

      // Ankle
      ctx.fillStyle = '#806050';
      ctx.beginPath(); ctx.arc(ankleX, drawAnkleY, 5, 0, Math.PI*2); ctx.fill();

      // Two toes (ostrich hallmark)
      const lift = onGround ? 0 : 12;
      ctx.strokeStyle = '#5a3820'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ankleX, drawAnkleY);
      ctx.quadraticCurveTo(ankleX+10, drawAnkleY+lift*0.5, ankleX+26, drawAnkleY+4);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ankleX, drawAnkleY); ctx.lineTo(ankleX-13, drawAnkleY+3); ctx.stroke();
      // Claws
      ctx.strokeStyle = '#1a0a00'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ankleX+26, drawAnkleY+4); ctx.lineTo(ankleX+33, drawAnkleY+2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ankleX-13, drawAnkleY+3); ctx.lineTo(ankleX-19, drawAnkleY+1); ctx.stroke();
    });
  }

  _drawBody(ctx, isPlayer) {
    // Real ostrich body: nearly black with dark brown/charcoal feathers
    // Body center at y=-100, above legs (hips at y=-62)
    const bx = 14, by = -100;

    // ── Tail feathers — fluffy white/grey plumes at back (real ostrich has white tail) ──
    ctx.save();
    ctx.translate(bx - 34, by + 8);
    for (let i = 0; i < 9; i++) {
      const angle  = -0.7 + i * 0.18;
      const len    = 30 + (i % 3) * 8;
      const tx     = Math.cos(angle + Math.PI) * len;
      const ty     = Math.sin(angle + Math.PI) * len;
      // Males have white tail plumes, females dark
      const tailColor = i % 2 === 0 ? 'rgba(240,235,230,0.92)' : 'rgba(200,195,190,0.75)';
      ctx.strokeStyle = tailColor;
      ctx.lineWidth   = 5 - (i % 3);
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(tx*0.45+4, ty*0.45-10, tx, ty);
      ctx.stroke();
    }
    ctx.restore();

    // ── Main body: dark charcoal-black, slightly elongated ──
    const bodyGrad = ctx.createRadialGradient(bx-14, by-16, 3, bx, by, 50);
    bodyGrad.addColorStop(0,    '#4a4a50');   // lit top (dark grey)
    bodyGrad.addColorStop(0.30, '#282830');   // mid dark
    bodyGrad.addColorStop(0.70, '#141418');   // very dark
    bodyGrad.addColorStop(1,    '#080808');   // near black edge
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(bx, by, 40, 46, -0.08, 0, Math.PI*2);
    ctx.fill();

    // ── Wing feather texture (dark feather layers) ──
    for (let i = 0; i < 6; i++) {
      const wy = by - 14 + i * 10;
      const wx = bx - 34 + i * 2;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(60,58,62,0.9)' : 'rgba(35,33,38,0.9)';
      ctx.lineWidth   = 9 - i * 0.8;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.ellipse(wx+20, wy, 24-i*1.5, 9, 0.28, Math.PI*0.05, Math.PI*0.95);
      ctx.stroke();
    }

    // ── Accent color patch on wing (the ostrich's individual color identifier) ──
    ctx.save();
    ctx.globalAlpha = 0.65;
    const accentGrad = ctx.createRadialGradient(bx-5, by+4, 0, bx-5, by+4, 22);
    accentGrad.addColorStop(0, this._lighten(this.color, 30));
    accentGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = accentGrad;
    ctx.beginPath();
    ctx.ellipse(bx-5, by+4, 18, 14, 0.2, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // ── Sunlit rim (warm golden from right-side sun) ──
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = 'rgba(255,200,100,1)';
    ctx.lineWidth   = 5;
    ctx.beginPath();
    ctx.ellipse(bx, by, 42, 48, -0.08, -0.55, 0.65);
    ctx.stroke();
    ctx.restore();

    // ── Top specular (feather sheen) ──
    ctx.save();
    ctx.globalAlpha = 0.12;
    const sg = ctx.createRadialGradient(bx-10, by-24, 0, bx-10, by-24, 28);
    sg.addColorStop(0, 'rgba(255,255,255,1)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(bx-10, by-22, 24, 14, -0.25, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Player gold ring
    if (isPlayer) {
      ctx.strokeStyle = '#f1c40f';
      ctx.lineWidth   = 4;
      ctx.shadowColor = '#f1c40f';
      ctx.shadowBlur  = 20;
      ctx.beginPath();
      ctx.ellipse(bx, by, 46, 52, -0.08, 0, Math.PI*2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  _drawNeckHead(ctx) {
    // Real ostrich: LONG bare grey-pink neck, small flat head
    const sway = Math.sin(this.neckPhase) * 5;
    const bob  = Math.abs(Math.sin(this.stridePhase)) * -4;

    // Neck runs from body top up and forward
    const nx0 = 40,  ny0 = -136;        // base (just above body top)
    const nx1 = 52 + sway*0.4, ny1 = -154 + bob*0.3;
    const nx2 = 60 + sway, ny2 = -170 + bob;

    // Neck shadow
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth   = 16;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(nx0+2, ny0+2);
    ctx.quadraticCurveTo(nx1+2, ny1+2, nx2+2, ny2+2);
    ctx.stroke();

    // Neck back (darker, shadow side)
    ctx.strokeStyle = '#8a6858';
    ctx.lineWidth   = 14;
    ctx.beginPath();
    ctx.moveTo(nx0, ny0); ctx.quadraticCurveTo(nx1, ny1, nx2, ny2); ctx.stroke();

    // Neck main (pale grey-pink, bare skin — like real ostrich)
    const nGrad = ctx.createLinearGradient(nx0-8, ny0, nx0+8, ny0);
    nGrad.addColorStop(0,    '#ddd0c0');  // lit side
    nGrad.addColorStop(0.4,  '#c8b8a8');  // mid
    nGrad.addColorStop(1,    '#a09080');  // shadow side
    ctx.strokeStyle = nGrad;
    ctx.lineWidth   = 11;
    ctx.beginPath();
    ctx.moveTo(nx0, ny0); ctx.quadraticCurveTo(nx1, ny1, nx2, ny2); ctx.stroke();

    // Neck pin-feather texture
    ctx.strokeStyle = 'rgba(90,70,60,0.12)';
    ctx.lineWidth = 1.5;
    for (let n = 0; n < 6; n++) {
      const nt = n / 5;
      const cx = nx0 + (nx2-nx0)*nt;
      const cy = ny0 + (ny2-ny0)*nt;
      ctx.beginPath(); ctx.moveTo(cx-6, cy+1); ctx.lineTo(cx+6, cy-1); ctx.stroke();
    }

    // Neck-to-body join feather tuft
    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let f = 0; f < 4; f++) {
      ctx.beginPath();
      ctx.moveTo(nx0 - 4 + f*3, ny0 + 4);
      ctx.lineTo(nx0 - 8 + f*4, ny0 + 16);
      ctx.stroke();
    }

    // ── HEAD ──  (small, flat, grey)
    const hx = nx2 + 5;
    const hy = ny2 - 8;

    // Head shadow
    ctx.save(); ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(hx+2, hy+2, 18, 12, 0.2, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // Head base (flat, grey-pink)
    const hGrad = ctx.createRadialGradient(hx-5, hy-4, 1, hx, hy, 18);
    hGrad.addColorStop(0,   '#e0d0c0');
    hGrad.addColorStop(0.5, '#c0b0a0');
    hGrad.addColorStop(1,   '#907860');
    ctx.fillStyle = hGrad;
    ctx.beginPath(); ctx.ellipse(hx, hy, 17, 11, 0.2, 0, Math.PI*2); ctx.fill();

    // Eye socket
    ctx.fillStyle = '#806050';
    ctx.beginPath(); ctx.arc(hx+7, hy-3, 6.5, 0, Math.PI*2); ctx.fill();

    // Sclera
    ctx.fillStyle = '#f0e8d8';
    ctx.beginPath(); ctx.arc(hx+7, hy-3, 5, 0, Math.PI*2); ctx.fill();

    // Iris (amber-brown like real ostrich)
    ctx.fillStyle = '#a06820';
    ctx.beginPath(); ctx.arc(hx+8, hy-3, 3.5, 0, Math.PI*2); ctx.fill();

    // Pupil
    ctx.fillStyle = '#050505';
    ctx.beginPath(); ctx.arc(hx+8.5, hy-3.5, 2, 0, Math.PI*2); ctx.fill();

    // Catchlight
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath(); ctx.arc(hx+9.5, hy-4.8, 1.0, 0, Math.PI*2); ctx.fill();

    // Eye ring (golden, real ostrich has distinctive eye ring)
    ctx.strokeStyle = '#d4a020'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(hx+7, hy-3, 5.5, 0, Math.PI*2); ctx.stroke();

    // ── Beak (flat, pink-grey, wide) ──
    const beakOpen = Math.max(0, Math.sin(this.stridePhase * 1.2)) * 2.5;
    const bkx = hx + 14, bky = hy + 1;

    ctx.fillStyle = '#c0a090';  // pinkish-grey beak
    ctx.beginPath();
    ctx.moveTo(hx+10, bky-3);
    ctx.quadraticCurveTo(bkx+2, bky-2-beakOpen, bkx+12, bky-1-beakOpen);
    ctx.quadraticCurveTo(bkx+2, bky+1, hx+10, bky);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#a08878';
    ctx.beginPath();
    ctx.moveTo(hx+10, bky);
    ctx.quadraticCurveTo(bkx+2, bky+1, bkx+11, bky+2+beakOpen);
    ctx.quadraticCurveTo(bkx, bky+3, hx+10, bky+3);
    ctx.closePath(); ctx.fill();

    // Beak nostril dot
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath(); ctx.ellipse(hx+13, bky-1, 2, 1.2, 0.3, 0, Math.PI*2); ctx.fill();

    // ── Small head plume (3 thin feathers) ──
    ctx.strokeStyle = '#888070'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let f = 0; f < 3; f++) {
      ctx.beginPath();
      ctx.moveTo(hx - 1 + f*3, hy - 9);
      ctx.quadraticCurveTo(hx + f*2 - 2, hy - 18, hx + f*3 - 5, hy - 22);
      ctx.stroke();
    }
  }

  _drawJockey(ctx) {
    // Jockey sits on ostrich back — body center y=-100, body top ~y=-146
    const jX  = 18;
    const jY  = -142;
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
    // Badge on body center
    const bX = 14;
    const bY = -100;

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
