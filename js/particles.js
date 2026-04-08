// =============================================
//  CORSA DEGLI STRUZZI - Particle Systems
// =============================================

class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  // Dust cloud behind an ostrich — bigger, layered
  emitDust(x, y, color) {
    const dustColors = ['#d4a86a', '#c09050', '#e8c080', color || '#c9a84c'];
    for (let i = 0; i < 5; i++) {
      const c = dustColors[Math.floor(Math.random() * dustColors.length)];
      this.particles.push({
        type: 'dust',
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 12,
        vx: -1.2 - Math.random() * 2.5,
        vy: -0.3 - Math.random() * 1.8,
        life: 1.0,
        decay: 0.018 + Math.random() * 0.015,
        radius: 5 + Math.random() * 12,
        color: c,
      });
    }
  }

  // Speed line streaks for bursting ostriches
  emitSpeedLines(x, y, color) {
    for (let i = 0; i < 4; i++) {
      this.particles.push({
        type: 'speedline',
        x: x + (Math.random() - 0.5) * 15,
        y: y - 20 - Math.random() * 60,
        vx: -4 - Math.random() * 5,
        vy: (Math.random() - 0.5) * 0.8,
        life: 1.0,
        decay: 0.06 + Math.random() * 0.05,
        length: 20 + Math.random() * 40,
        color: color || '#f1c40f',
      });
    }
  }

  // Confetti burst on winner reveal
  emitConfetti(cx, cy, count = 140) {
    const colors = ['#f1c40f','#e74c3c','#3498db','#27ae60','#9b59b6','#e67e22','#fff','#ff69b4'];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 14;
      const isStreamer = Math.random() > 0.6;
      this.particles.push({
        type: 'confetti',
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 8,
        life: 1.0,
        decay: 0.006 + Math.random() * 0.007,
        width:  isStreamer ? 3 + Math.random() * 4   : 7 + Math.random() * 9,
        height: isStreamer ? 12 + Math.random() * 16 : 4 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.25,
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity: 0.2 + Math.random() * 0.1,
      });
    }
  }

  // Heat shimmer rising from ground
  emitHeat(canvasWidth, groundY) {
    if (Math.random() > 0.4) return;
    this.particles.push({
      type: 'heat',
      x: Math.random() * canvasWidth,
      y: groundY - Math.random() * 20,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.5 - Math.random() * 0.8,
      life: 0.7 + Math.random() * 0.3,
      decay: 0.007 + Math.random() * 0.005,
      radius: 3 + Math.random() * 6,
    });
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x  += p.vx;
      p.y  += p.vy;
      p.life -= p.decay;

      if (p.type === 'confetti') {
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.rotation += p.rotSpeed;
      }
      if (p.type === 'dust') {
        p.vx    *= 0.92;
        p.vy    *= 0.90;
        p.radius += 0.5;
      }
      if (p.type === 'speedline') {
        p.vx *= 0.88;
      }

      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  draw(ctx, cameraX = 0) {
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life * p.life); // quadratic fade = softer

      if (p.type === 'dust') {
        const drawX = p.x - cameraX;
        // Soft radial dust puff
        const dg = ctx.createRadialGradient(drawX, p.y, 0, drawX, p.y, p.radius);
        dg.addColorStop(0,   p.color + 'cc');
        dg.addColorStop(0.5, p.color + '66');
        dg.addColorStop(1,   p.color + '00');
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.arc(drawX, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

      } else if (p.type === 'speedline') {
        const drawX = p.x - cameraX;
        ctx.strokeStyle = p.color;
        ctx.lineWidth   = 1.5;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(drawX, p.y);
        ctx.lineTo(drawX - p.length, p.y + p.vy * 3);
        ctx.stroke();

      } else if (p.type === 'confetti') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);

      } else if (p.type === 'heat') {
        const hg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
        hg.addColorStop(0,   `rgba(255,220,140,${p.life * 0.18})`);
        hg.addColorStop(1,   'rgba(255,200,100,0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });
  }
}
