// Title, help, shop, pause and game-over panels.

const $ = (sel, root = document) => root.querySelector(sel);

export class Screens {
  constructor(handlers) {
    this.h = handlers;
    this.screens = new Map();
    for (const el of document.querySelectorAll('.screen')) {
      this.screens.set(el.id.replace('screen-', ''), el);
    }
    this.options = { mode: 'ai', difficulty: 'normal', assist: 'partial' };
    this.current = 'title';
    this._wire();
  }

  _wire() {
    const seg = (id, key) => {
      const root = $(`#${id}`);
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        for (const b of root.children) b.classList.toggle('on', b === btn);
        this.options[key] = btn.dataset.value;
        this.h.onOption?.(key, btn.dataset.value);
        if (key === 'mode') $('#difficulty-group').style.display = btn.dataset.value === 'ai' ? '' : 'none';
      });
    };
    seg('opt-mode', 'mode');
    seg('opt-difficulty', 'difficulty');
    seg('opt-assist', 'assist');

    $('#btn-start').addEventListener('click', () => this.h.onStart?.(this.options));
    $('#btn-help').addEventListener('click', () => this.show('help'));
    $('#btn-menu-help').addEventListener('click', () => this.show('help'));
    $('#btn-shop-close').addEventListener('click', () => this.hide());
    $('#btn-resign').addEventListener('click', () => this.h.onResign?.());
    $('#btn-sound').addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', String(on));
      e.currentTarget.textContent = `Sound: ${on ? 'on' : 'off'}`;
      this.h.onSound?.(on);
    });
    $('#btn-rematch').addEventListener('click', () => this.h.onStart?.(this.options));
    $('#btn-totitle').addEventListener('click', () => this.show('title'));
    for (const btn of document.querySelectorAll('[data-close-screen]')) {
      btn.addEventListener('click', () => {
        if (this.current === 'help' && this.previous) this.show(this.previous);
        else this.hide();
      });
    }
    $('#screen-shop').addEventListener('click', (e) => {
      if (e.target.id === 'screen-shop') this.hide();
    });
  }

  show(name) {
    if (this.current && this.current !== name) this.previous = this.current;
    for (const [key, el] of this.screens) el.classList.toggle('show', key === name);
    this.current = name;
    this.h.onScreenChange?.(name);
  }

  hide() {
    for (const el of this.screens.values()) el.classList.remove('show');
    this.previous = this.current;
    this.current = null;
    this.h.onScreenChange?.(null);
  }

  get isOpen() { return this.current !== null; }

  /* ── shop ────────────────────────────────────────────────────────── */

  renderShop(items, gold) {
    $('#shop-gold').textContent = Math.round(gold);
    const root = $('#shop-items');
    root.innerHTML = '';
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'shop-item' + (item.available ? '' : ' maxed');
      el.innerHTML = `
        <h3></h3>
        <p></p>
        <button class="shop-buy"><i class="ico ico-gold"></i><span></span></button>`;
      el.querySelector('h3').textContent = item.name;
      el.querySelector('p').textContent = item.available ? item.desc : 'Nothing more to buy here.';
      const btn = el.querySelector('.shop-buy');
      btn.querySelector('span').textContent = item.cost;
      btn.disabled = !item.available || !item.affordable;
      btn.addEventListener('click', () => this.h.onBuy?.(item.id));
      root.append(el);
    }
  }

  /* ── game over ───────────────────────────────────────────────────── */

  showGameOver(result, names, playerWon) {
    const title = $('#go-title');
    const reasons = {
      throne: 'The throne room is rubble and the crown is lost.',
      disarmed: 'Not a gun left on the walls, and no coin to cast another.',
      attrition: 'No powder, no coin, no hope — the siege is given up.',
      siege: 'Neither throne fell, but one castle stands taller than the other.',
      resigned: 'The banner comes down; the siege is abandoned.',
    };
    const winner = names[result.winner];
    title.textContent = playerWon === null
      ? `${winner} wins`
      : playerWon ? 'Victory!' : 'Defeat';
    title.className = playerWon === false ? 'lose' : 'win';
    $('#go-text').textContent = `${reasons[result.reason] || ''} ${winner} takes the field after ${result.round} round${result.round > 1 ? 's' : ''}.`;

    const stats = $('#go-stats');
    stats.innerHTML = '';
    for (const p of result.players) {
      const acc = p.shots ? Math.round((p.hits / p.shots) * 100) : 0;
      const el = document.createElement('div');
      el.className = 'go-stat';
      el.innerHTML = `<b></b><span></span>`;
      el.querySelector('b').textContent = `${acc}%`;
      el.querySelector('span').textContent = `${p.name}: ${p.hits}/${p.shots} on target, ${p.blocksDestroyed} blocks felled`;
      stats.append(el);
    }
    this.show('gameover');
  }
}
