// =============================================
//  CORSA DEGLI STRUZZI - Voice Commentary Engine
//  Uses Web Speech API - Italian, emotionally tuned
// =============================================

const voiceCommentary = (() => {
  'use strict';

  // ── State ──────────────────────────────────────────
  let _voice         = null;
  let _ready         = false;
  let _speaking      = false;
  let _queue         = [];          // { text, rate, pitch }
  let _lastEventTime = {};
  let _raceStarted   = false;
  let _finalSpoken   = false;
  let _halfSpoken    = false;
  let _quarterSpoken = false;
  let _lastBurstId   = null;
  let _lastGapState  = null;
  let _overtakeCount = 0;

  // ── Voice selection ────────────────────────────────
  function _loadVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;

    const it = voices.filter(v => v.lang.startsWith('it'));
    if (it.length) {
      // Prefer local service (better quality), then any Italian
      const local = it.find(v => v.localService);
      _voice = local || it[0];
    } else {
      _voice = voices[0];
    }
    _ready = true;
  }

  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.onvoiceschanged = _loadVoice;
    _loadVoice();
  }

  // ── Core speak — accepts { text, rate, pitch, priority } ─
  function _speak(text, { rate = 1.1, pitch = 1.0, priority = false } = {}) {
    if (!_ready || typeof speechSynthesis === 'undefined') return;

    if (priority) {
      speechSynthesis.cancel();
      _queue = [];
    } else if (_speaking || _queue.length > 0) {
      return; // never pile up — drop non-priority if busy
    }

    _queue.push({ text, rate, pitch });
    _flush();
  }

  function _flush() {
    if (_queue.length === 0) return;
    if (speechSynthesis.speaking) return;

    const item = _queue.shift();
    const utt  = new SpeechSynthesisUtterance(item.text);
    utt.lang   = _voice ? _voice.lang : 'it-IT';
    if (_voice) utt.voice = _voice;
    utt.rate   = item.rate;
    utt.pitch  = item.pitch;
    utt.volume = 1.0;

    utt.onstart = () => { _speaking = true; };
    utt.onend   = () => { _speaking = false; setTimeout(_flush, 80); };
    utt.onerror = () => { _speaking = false; _queue = []; };

    speechSynthesis.speak(utt);
  }

  // ── Helpers ───────────────────────────────────────
  function _cooldown(key, ms) {
    const now = Date.now();
    if (_lastEventTime[key] && now - _lastEventTime[key] < ms) return false;
    _lastEventTime[key] = now;
    return true;
  }

  function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function _n(name) {
    // Use full name but shorten "del Sahara" → "Sahara" etc. for flow
    if (!name) return '';
    const w = name.split(' ');
    // Drop prepositions like 'del', 'di', 'del'
    return w.filter(x => !['del','di','della','dello'].includes(x.toLowerCase())).join(' ');
  }

  // ── RACE START ───────────────────────────────────
  function sayStart(ostriches) {
    _raceStarted   = true;
    _finalSpoken   = false;
    _halfSpoken    = false;
    _quarterSpoken = false;
    _lastBurstId   = null;
    _lastGapState  = null;
    _overtakeCount = 0;
    _lastEventTime = {};
    _queue         = [];
    speechSynthesis.cancel();

    const names = ostriches.map(o => _n(o.name)).join(', ');
    // Slow buildup intro, then accelerate — like a real broadcaster
    const phrases = [
      `Signore... e signori... benvenuti alla corsa degli struzzi! In pista oggi: ${names}. E... VIA! Che partenza spettacolare!`,
      `Tutto pronto. La tensione è alle stelle. E... sono partiti! ${ostriches.length} campioni del deserto verso la gloria!`,
      `Il momento è arrivato. Il deserto chiama. E VIA! ${names}... scattano verso il traguardo! Che emozione incredibile!`,
    ];
    setTimeout(() => _speak(_pick(phrases), { rate: 1.05, pitch: 1.05, priority: true }), 500);
  }

  // ── PER-FRAME EVENTS ──────────────────────────────
  function onFrame({ leaderProgress, leader, second, gap, bursting,
                     overtake, prevLeader, raceRatio }) {
    if (!_ready || !_raceStarted) return;

    const L = leader ? _n(leader.name) : '';
    const S = second ? _n(second.name) : '';

    // ── OVERTAKE — slow dramatic buildup then explosive finish ──
    if (overtake && prevLeader && leader && _cooldown('overtake', 3500)) {
      _overtakeCount++;
      const prev = _n(prevLeader.name);
      const isRepeat = _overtakeCount > 2;
      const phrases = [
        // Broadcaster style: pause on name, then explode
        { t: `${L}... sta andando, sta andando... SORPASSO! ${L} supera ${prev}! Incredibile!`,         r: 1.0, p: 1.08 },
        { t: `Attenzione... attenzione... cambia la testa! È ${L}! ${L} davanti a tutti! PAZZESCO!`,    r: 1.0, p: 1.08 },
        { t: `Guardate ${L}... si avvicina, si avvicina... e lo prende! Sorpasso fantastico!`,           r: 1.0, p: 1.06 },
        { t: `${prev} non riesce a tenere... e ${L} lo supera! Che mossa straordinaria! La gara si ribalta!`, r: 1.05, p: 1.08 },
        { t: `Cambio in testa! ${L} è primo! ${prev} deve rispondere adesso, immediatamente!`,          r: 1.1,  p: 1.1  },
        isRepeat
          ? { t: `Di nuovo, di nuovo! ${L} sorpassa ancora! Questa gara è completamente folle! Assurdo!`, r: 1.1, p: 1.12 }
          : { t: `Ribaltone totale! ${L} comanda! Chi riuscirà a fermare questo campione?`,               r: 1.05, p: 1.08 },
      ];
      const chosen = _pick(phrases);
      _speak(chosen.t, { rate: chosen.r, pitch: chosen.p, priority: true });
      return;
    }

    // ── SPRINT BURST ───────────────────────────────
    if (bursting.length > 0 && _cooldown('burst', 4500)) {
      const b = bursting[Math.floor(Math.random() * bursting.length)];
      if (b.id !== _lastBurstId || _cooldown('sameBurst', 7000)) {
        _lastBurstId = b.id;
        const B = _n(b.name);
        const phrases = [
          { t: `${B} scatta! Guardate quell'accelerazione, è impressionante! Che potenza!`,      r: 1.08, p: 1.05 },
          { t: `Esplosione di ${B}! Una velocità devastante! Nessuno riesce a stargli dietro!`,  r: 1.08, p: 1.05 },
          { t: `${B} mette il turbo! Dove trova questa energia? È straordinario, strepitoso!`,   r: 1.05, p: 1.03 },
          { t: `Guarda ${B}! Sta volando sul deserto! La folla è in delirio!`,                   r: 1.08, p: 1.06 },
          { t: `${B} parte come un razzo! Tutti gli altri devono rispondere adesso!`,            r: 1.1,  p: 1.08 },
          { t: `Che scatto pazzesco di ${B}! La folla è in piedi! Questo è sport vero!`,        r: 1.08, p: 1.06 },
        ];
        const c = _pick(phrases);
        _speak(c.t, { rate: c.r, pitch: c.p });
        return;
      }
    }

    // ── HEAD TO HEAD ───────────────────────────────
    if (gap < 0.016 && leaderProgress > 0.2) {
      if (_lastGapState !== 'tight' && _cooldown('headtohead', 4500)) {
        _lastGapState = 'tight';
        const phrases = [
          { t: `Testa a testa! ${L} e ${S}... assolutamente inseparabili! Che adrenalina, signore e signori!`, r: 1.0, p: 1.04 },
          { t: `Un filo li separa. Un filo soltanto. ${L} contro ${S}! Non si molla nessuno!`,                  r: 0.98, p: 1.02 },
          { t: `Che battaglia! ${L} e ${S} fianco a fianco! Chi cederà per primo? Il cuore in gola!`,           r: 1.0,  p: 1.04 },
          { t: `Stanno lottando come veri campioni. ${L} e ${S}. Nemmeno un centimetro li divide!`,             r: 0.98, p: 1.02 },
          { t: `Incredibile. Tra ${L} e ${S} ci sono pochi centimetri. Questo è spettacolo puro!`,             r: 0.98, p: 1.02 },
        ];
        const c = _pick(phrases);
        _speak(c.t, { rate: c.r, pitch: c.p });
        return;
      }
    } else if (gap > 0.05) {
      _lastGapState = 'open';
    }

    // ── MILESTONES ────────────────────────────────
    if (raceRatio > 0.25 && !_quarterSpoken && _cooldown('quarter', 999999)) {
      _quarterSpoken = true;
      const phrases = [
        { t: `Primo quarto di gara. ${L} conduce con autorità... ma il gruppo è agguerrito. Tutto può ancora succedere.`, r: 0.95, p: 1.0 },
        { t: `Venticinque percento completato. ${L} in testa, compatto il gruppo dietro. Occhio agli sviluppi.`,           r: 0.95, p: 1.0 },
      ];
      const c = _pick(phrases);
      _speak(c.t, { rate: c.r, pitch: c.p });
      return;
    }

    if (raceRatio > 0.5 && !_halfSpoken && _cooldown('half', 999999)) {
      _halfSpoken = true;
      const phrases = [
        { t: `Siamo... a metà gara. ${L} è ancora in testa. Ma la corsa... è tutt'altro che decisa. Tutto può succedere!`, r: 0.95, p: 1.02 },
        { t: `Metà percorso. ${L} comanda, ma il gruppo lo tiene d'occhio. La tensione è palpabile!`,                        r: 0.95, p: 1.02 },
        { t: `Cinquanta percento. Siamo a metà, signore e signori. ${L} davanti... ma attenzione, niente è scontato!`,       r: 0.95, p: 1.0  },
      ];
      const c = _pick(phrases);
      _speak(c.t, { rate: c.r, pitch: c.p });
      return;
    }

    if (raceRatio > 0.82 && !_finalSpoken && _cooldown('final', 999999)) {
      _finalSpoken = true;
      const phrases = [
        // Slow start, exploding finish — peak broadcaster technique
        { t: `Ultimi metri... il traguardo si avvicina... ${L}... lancia la volata! FORZA! Può ancora succedere di tutto!`,           r: 0.95, p: 1.08 },
        { t: `Finale di gara! Il cuore... in gola! ${L} in testa... ma guarda come si avvicina il gruppo! Adrenalina totale!`,        r: 0.95, p: 1.08 },
        { t: `Mancano pochissimi metri! ${L}... spinge al massimo! La folla urla! Questo è il momento della verità!`,                  r: 0.95, p: 1.1  },
        { t: `Adesso... o mai più! ${L}... verso il traguardo! Tutto il fiato in una volta sola! Che spettacolo meraviglioso!`,        r: 0.95, p: 1.08 },
      ];
      const c = _pick(phrases);
      _speak(c.t, { rate: c.r, pitch: c.p, priority: true });
      return;
    }

    // ── PERIODIC ──────────────────────────────────
    if (_cooldown('periodic', 11000) && leaderProgress > 0.12) {
      const phrases = [
        { t: `${L} mantiene la testa. Che controllo della gara, che classe!`,                    r: 0.98, p: 1.0  },
        { t: `Continua a spingere ${L}. La forma è straordinaria oggi, straordinaria!`,          r: 0.98, p: 1.0  },
        { t: `Il gruppo insegue, ma ${L} non si fa riprendere. Grande, grandissima performance!`,r: 0.98, p: 1.0  },
        { t: `${L} davanti a tutti. Il deserto brucia sotto il sole, ma ${L} non rallenta!`,     r: 0.98, p: 1.0  },
        { t: `Che gara signore e signori. ${L} in testa, ma occhio... occhio agli altri!`,       r: 0.95, p: 1.0  },
        { t: `${L} è un treno oggi. Inarrestabile. Riuscirà qualcuno a fermarlo?`,               r: 0.95, p: 1.0  },
        { t: `Il vantaggio di ${L} regge. Ma in questa gara nessuno ha già vinto. Nessuno!`,     r: 0.95, p: 1.0  },
      ];
      const c = _pick(phrases);
      _speak(c.t, { rate: c.r, pitch: c.p });
    }
  }

  // ── WINNER ───────────────────────────────────────
  function sayWinner(winner) {
    if (!winner) return;
    const name = _n(winner.name);
    // Iconic broadcaster crescendo: slow → medium → explosive
    const phrases = [
      { t: `E... ${name}... taglia il traguardo! ${name} HA VINTO! Che prestazione leggendaria! Complimenti, complimenti dal profondo del cuore!`, r: 0.95, p: 1.1 },
      { t: `È lui! È ${name}! IL CAMPIONE! Vittoria assolutamente meritatissima! Che gara indimenticabile, storica!`,                               r: 0.95, p: 1.1 },
      { t: `${name}... ${name}... PRIMO! Il vincitore è ${name}! La folla è in delirio! Che corsa, che corsa meravigliosa!`,                        r: 0.95, p: 1.1 },
      { t: `Trionfo assoluto di ${name}! Un campione vero! Una corsa che resterà nella storia! Bravissimo ${name}, bravissimo!`,                    r: 0.95, p: 1.1 },
    ];
    const c = _pick(phrases);
    _speak(c.t, { rate: c.r, pitch: c.p, priority: true });
  }

  // ── CONTROL ──────────────────────────────────────
  function pause()  { speechSynthesis.cancel(); _queue = []; }
  function resume() {}
  function stop()   { _raceStarted = false; speechSynthesis.cancel(); _queue = []; _speaking = false; }

  return { sayStart, onFrame, sayWinner, pause, resume, stop };
})();
