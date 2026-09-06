// Binds the DOM overlay to the match. Reads game state, writes text — it never
// changes the simulation except through the callbacks handed to it.

const $ = (sel, root = document) => root.querySelector(sel);

export class Hud {
  constructor(handlers) {
    this.h = handlers;
    this.root = $('#hud');
    this.cards = [$('#card-0'), $('#card-1')];
    this.roundNum = $('#round-num');
    this.windText = $('#wind-text');
    this.windArrow = $('#wind-arrow');
    this.dock = $('#dock');
    this.dockHint = $('#dock-hint');
    this.outAngle = $('#out-angle');
    this.outPower = $('#out-power');
    this.rngAngle = $('#rng-angle');
    this.rngPower = $('#rng-power');
    this.btnFire = $('#btn-fire');
    this.btnShop = $('#btn-shop');
    this.btnCannon = $('#btn-cannon');
    this.cannonLabel = $('#cannon-label');
    this.btnView = $('#btn-view');
    this.btnMenu = $('#btn-menu');
    this.toastStack = $('#toast-stack');
    this.banner = $('#turn-banner');
    this.statusLine = $('#status-line');
    this.prev = [{}, {}];
    this._wire();
  }

  _wire() {
    const live = (el, key) => {
      const send = () => this.h.onAim?.(key, Number(el.value));
      el.addEventListener('input', send);
      el.addEventListener('change', send);
    };
    live(this.rngAngle, 'angle');
    live(this.rngPower, 'power');

    for (const btn of document.querySelectorAll('.nudge')) {
      let timer = null, repeat = null;
      const fire = () => this.h.onNudge?.(btn.dataset.adj, Number(btn.dataset.delta));
      const start = (e) => {
        e.preventDefault();
        fire();
        timer = setTimeout(() => { repeat = setInterval(fire, 70); }, 380);
      };
      const stop = () => { clearTimeout(timer); clearInterval(repeat); repeat = null; };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
    }

    this.btnFire.addEventListener('click', () => this.h.onFire?.());
    this.btnShop.addEventListener('click', () => this.h.onShop?.());
    this.btnCannon.addEventListener('click', () => this.h.onCycleCannon?.());
    this.btnView.addEventListener('click', () => this.h.onToggleView?.());
    this.btnMenu.addEventListener('click', () => this.h.onMenu?.());
  }

  show(on) { this.root.hidden = !on; }

  setOverview(on) { this.btnView.classList.toggle('on', on); }

  /** Player cards: gold, powder, guns, castle integrity. */
  updateStats(snapshot) {
    snapshot.forEach((p, i) => {
      const card = this.cards[i];
      card.classList.toggle('active', p.active);
      $('.pc-name', card).textContent = p.name;
      const set = (key, value) => {
        const el = card.querySelector(`[data-stat="${key}"]`);
        if (!el || el.textContent === String(value)) return;
        el.textContent = value;
        const stat = el.closest('.stat');
        if (stat && this.prev[i][key] !== undefined && this.prev[i][key] !== value) {
          stat.classList.remove('flash');
          void stat.offsetWidth;
          stat.classList.add('flash');
        }
        this.prev[i][key] = value;
      };
      set('gold', Math.round(p.gold));
      set('powder', Math.round(p.powder));
      set('cannons', p.cannons);
      card.querySelector('[data-stat="integrity"]').style.width = `${Math.round(p.integrity * 100)}%`;
    });
  }

  updateRound(round, wind) {
    this.roundNum.textContent = round;
    const strength = Math.abs(wind);
    const label = strength < 0.07 ? 'calm'
      : strength < 0.3 ? 'light' : strength < 0.62 ? 'fresh' : 'strong';
    this.windText.textContent = label;
    this.windArrow.style.transform = wind >= 0 ? 'none' : 'scaleX(-1)';
    this.windArrow.style.opacity = strength < 0.07 ? 0.35 : String(0.55 + strength * 0.45);
  }

  /**
   * @param {boolean} yours false while the computer is taking its turn — the
   * dock slides away rather than showing the opponent's firing solution.
   */
  updateAim(aim, canFire, phase, yours) {
    if (Math.abs(Number(this.rngAngle.value) - aim.angle) > 0.05) this.rngAngle.value = aim.angle;
    if (Math.abs(Number(this.rngPower.value) - aim.power) > 0.05) this.rngPower.value = aim.power;
    this.outAngle.textContent = `${aim.angle.toFixed(0)}°`;
    this.outPower.textContent = aim.power.toFixed(0);
    // when there is nothing to shoot with, the button becomes the way out
    this.endTurnMode = !canFire.ok && (canFire.code === 'nocannon' || canFire.code === 'nopowder');
    this.btnFire.disabled = !canFire.ok && !this.endTurnMode;
    this.btnFire.textContent = canFire.ok ? 'FIRE'
      : this.endTurnMode ? 'END TURN' : (canFire.reason || 'FIRE').toUpperCase();
    this.btnShop.disabled = !yours;
    const many = aim.cannonCount > 1;
    this.btnCannon.hidden = !many || !yours;
    if (many) this.cannonLabel.textContent = `${aim.cannonIndex}/${aim.cannonCount}`;
    this.dock.classList.toggle('hidden', phase !== 'aim' || !yours);
  }

  setHint(text) {
    this.dockHint.textContent = text || '';
    this.dockHint.hidden = !text;
  }

  /** Shown while the other side is thinking, so the game never looks stuck. */
  setStatus(text) {
    if (!this.statusLine) return;
    this.statusLine.textContent = text || '';
    this.statusLine.hidden = !text;
  }

  toast(text, kind = 'normal') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastStack.append(el);
    while (this.toastStack.children.length > 3) this.toastStack.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, kind === 'big' ? 2600 : 2000);
  }

  showBanner(text, color, ms = 1300) {
    this.banner.textContent = text;
    this.banner.style.color = color;
    this.banner.hidden = false;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { this.banner.hidden = true; }, ms);
    // restart the entry animation
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
  }
}
