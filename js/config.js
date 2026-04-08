// =============================================
//  CORSA DEGLI STRUZZI - Configuration
// =============================================

const CONFIG = {
  NUM_OSTRICHES: 6,
  RACE_DURATION: 45000,       // ms
  TRACK_LENGTH: 6000,         // world units (shorter = more action on screen)
  COUNTDOWN_FROM: 3,
  CAMERA_LEAD: 250,           // px ahead of leader

  // Drama engine — keep the pack tight
  DRAMA_GAP_THRESHOLD: 0.06,  // gap (0-1) before catch-up kicks in (was 0.18)
  DRAMA_STRENGTH: 4.0,        // how hard the catch-up is

  // Random burst events
  BURST_CHANCE: 0.003,        // per-frame chance of a burst per ostrich
  BURST_MAGNITUDE: 35,        // extra units/sec during burst
  BURST_DURATION_MIN: 800,    // ms
  BURST_DURATION_MAX: 2200,   // ms

  // Slipstream: following close behind gives a small bonus
  SLIP_DISTANCE: 80,          // world units
  SLIP_BONUS: 0.04,           // speed multiplier bonus

  // Finish line
  PHOTO_FINISH_THRESHOLD: 0.01,

  // Parallax layers scroll multipliers
  PARALLAX: [0.04, 0.12, 0.28, 0.55, 1.0],
};

const OSTRICH_DATA = [
  { id: 1, name: 'Sabbia Rossa',   color: '#e74c3c', jerseyColor: '#c0392b', baseSpeed: 0, odds: 0 },
  { id: 2, name: 'Vento Blu',      color: '#3498db', jerseyColor: '#2980b9', baseSpeed: 0, odds: 0 },
  { id: 3, name: 'Oro del Sahara', color: '#f1c40f', jerseyColor: '#d4ac0d', baseSpeed: 0, odds: 0 },
  { id: 4, name: 'Notte Viola',    color: '#9b59b6', jerseyColor: '#8e44ad', baseSpeed: 0, odds: 0 },
  { id: 5, name: 'Verde Oasi',     color: '#27ae60', jerseyColor: '#1e8449', baseSpeed: 0, odds: 0 },
  { id: 6, name: 'Arancio Fuoco',  color: '#e67e22', jerseyColor: '#d35400', baseSpeed: 0, odds: 0 },
];

// Randomize odds and speeds each session
function initOstrichData() {
  OSTRICH_DATA.forEach(o => {
    o.baseSpeed = 128 + Math.random() * 10; // very tight range — ~6000 units in 45s, forces overtakes
    o.stamina   = 0.5 + Math.random() * 0.5;     // affects late-race speed
    o.luck      = Math.random();                  // random noise amplitude
    // Odds inversely correlated with baseSpeed + small random noise
    const rawOdd = 1.5 + (138 - o.baseSpeed) * 0.25 + Math.random() * 2.0;
    o.odds = Math.round(rawOdd * 10) / 10;
  });
}
