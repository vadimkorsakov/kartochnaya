// Included only by the Netlify build; no automatic reloads, including other tabs.
export function waitForOfflineWorker(registration, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const workers = new Set();
    const timer = setTimeout(() => finish(Error('Подготовка офлайн-копии не завершилась за 30 секунд. Проверьте подключение и повторите попытку.')), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      registration.removeEventListener('updatefound', changed);
      for (const worker of workers) worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    }
    function changed() {
      const worker = registration.installing;
      if (worker && !workers.has(worker)) {
        workers.add(worker); worker.addEventListener('statechange', changed);
      }
      if ([...workers].some(worker => worker.state === 'redundant')) {
        finish(Error('Не удалось установить офлайн-копию. Возможны ошибка сети или несовпадение SHA-256 ресурсов. Повторите попытку; подробности — в консоли браузера.'));
      } else if (registration.waiting || (!registration.installing && registration.active?.state === 'activated')) finish();
    }
    registration.addEventListener('updatefound', changed); changed();
  });
}

export function installNetlifyPWA({ prepare, resume }) {
  if (!('serviceWorker' in navigator)) return;
  // The icon and optional popover never reserve vertical layout space.
  const style = document.createElement('style');
  style.textContent = "\n#pwaStatus{position:fixed;z-index:610;box-sizing:border-box;width:min(340px,calc(100vw - 16px));max-height:min(72dvh,420px);overflow:auto;border:1px solid #625475;border-radius:10px;background:#292630;color:#f3efff;box-shadow:0 16px 35px #0009;font:12px/1.4 system-ui}\n#pwaStatus[hidden],#pwaStatus [hidden],#pwaToggle[hidden]{display:none!important}\n#pwaStatus .pwa-row{display:flex;align-items:center;gap:8px;padding:9px 10px;min-height:36px}\n#pwaStatus .pwa-row+.pwa-row{padding-top:0}\n#pwaMessage{flex:1;min-width:0;overflow-wrap:anywhere}\n#pwaStatus button{flex:0 0 auto;border:1px solid #625475;border-radius:6px;background:#37313f;color:#f3efff;font:12px system-ui;min-height:30px;padding:4px 8px}\n#pwaStatus button:focus-visible,#pwaToggle:focus-visible{outline:2px solid #b99aff;outline-offset:2px}\n#pwaDetails{max-height:150px;overflow:auto;overflow-wrap:anywhere;margin:0;padding:0 10px 10px;white-space:pre-wrap}\n#pwaToggle{position:relative;display:grid;place-items:center;flex:0 0 32px;width:32px;height:30px;padding:5px;border:1px solid #625475;border-radius:6px;background:#302d38;color:#f3efff;cursor:pointer}\n#pwaToggle:hover{background:#423b4b}\n#documentTabs #pwaToggle{order:4;flex:0 0 32px;margin:0 5px 0 2px}\n#homePwaStatus #pwaToggle{margin:0}\n#pwaToggle .pwa-icon{display:block;width:20px;height:20px;fill:currentColor;flex:none}\n#pwaToggle .pwa-icon-saved{display:none}\n#pwaToggle[data-state=\"ready\"] .pwa-icon-loading,\n#pwaToggle[data-state=\"update\"] .pwa-icon-loading,\n#pwaToggle[data-state=\"error\"][data-ready=\"true\"] .pwa-icon-loading{display:none}\n#pwaToggle[data-state=\"ready\"] .pwa-icon-saved,\n#pwaToggle[data-state=\"update\"] .pwa-icon-saved,\n#pwaToggle[data-state=\"error\"][data-ready=\"true\"] .pwa-icon-saved{display:block}\n#pwaToggle[data-state=\"loading\"] .pwa-icon-loading{animation:pwa-cloud-pulse 1.35s ease-in-out infinite}\n#pwaToggle[data-state=\"update\"]::after,#pwaToggle[data-state=\"error\"]::after{content:'';position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#e2b1ff;box-shadow:0 0 0 1px #292630}\n#pwaToggle[data-state=\"error\"]::after{background:#ff999f}\n@keyframes pwa-cloud-pulse{0%,100%{opacity:1}50%{opacity:.35}}\n@media(prefers-reduced-motion:reduce){#pwaToggle[data-state=\"loading\"] .pwa-icon-loading{animation:none}}\n";
  document.head.append(style);
  const panel = document.createElement('aside');
  panel.id = 'pwaStatus';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Состояние офлайн-копии');
  panel.setAttribute('aria-live', 'polite');
  panel.dataset.offlineReady = 'false';
  const label = document.createElement('span');
  label.id = 'pwaMessage';
  const button = document.createElement('button');
  button.id = 'pwaUpdate'; button.textContent = 'Обновить'; button.hidden = true;
  const retry = document.createElement('button');
  retry.id = 'pwaRetry'; retry.textContent = 'Повторить подготовку'; retry.hidden = true;
  const toggle = document.createElement('button');
  toggle.id = 'pwaToggle'; toggle.type = 'button';
  toggle.dataset.state = 'loading'; toggle.dataset.ready = 'false';
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-label', 'Офлайн: подготовка версии…');
  toggle.title = 'Подготовка офлайн-версии…';
  // Two monochrome silhouettes are traced from the supplied reference icons.
  toggle.innerHTML = "<svg class=\"pwa-icon pwa-icon-loading\" viewBox=\"0 0 512 512\" aria-hidden=\"true\"><path fill-rule=\"evenodd\" d=\"M252,192 247,194 240,204 240,440 198,401 189,400 182,403 177,410 176,418 179,425 247,493 259,495 264,493 333,424 335,412 328,402 323,400 313,401 271,440 271,204 264,194Z M491,225 480,199 466,180 445,162 414,147 409,117 397,89 381,66 365,50 342,34 311,21 283,16 260,16 220,25 201,34 183,46 162,66 146,89 134,117 128,144 104,146 78,155 59,167 43,182 27,206 20,224 16,245 16,266 20,287 32,314 44,330 69,351 90,361 117,367 195,367 200,365 206,358 207,348 205,343 198,337 119,336 96,330 79,320 63,304 53,287 47,264 48,241 57,216 68,201 79,191 96,181 108,177 147,175 157,168 161,137 169,113 181,93 199,74 226,57 259,48 284,48 300,51 327,62 344,74 362,93 374,113 382,137 386,169 392,175 412,180 434,193 454,217 463,244 463,267 459,283 449,302 434,318 412,331 398,335 313,337 306,343 304,348 305,358 311,365 316,367 401,366 426,359 453,343 474,321 486,300 491,286 495,264 495,247Z\"/></svg><svg class=\"pwa-icon pwa-icon-saved\" viewBox=\"0 0 512 512\" aria-hidden=\"true\"><path fill-rule=\"evenodd\" d=\"M20,12 7,27 0,48 0,463 4,478 12,491 29,505 48,511 463,511 478,507 491,499 504,484 511,463 511,108 509,103 408,2 403,0 48,0 33,4Z M128,316 137,306 148,302 363,302 374,306 383,316 386,327 386,481 126,482 125,327Z M125,30 352,29 353,157 350,164 340,174 330,177 148,177 139,174 128,163 125,152Z M301,64 296,66 289,76 289,130 295,139 308,141 318,131 318,75 311,66Z M38,35 50,29 96,30 96,153 98,166 107,184 118,195 140,205 332,206 349,202 361,195 374,181 382,161 383,29 394,29 482,117 482,461 473,476 461,482 415,481 414,317 408,301 398,288 381,277 366,273 145,273 122,281 107,295 97,317 96,481 50,482 42,479 35,473 29,461 29,50 32,42Z\"/></svg>";
  const close = document.createElement('button');
  close.id = 'pwaClose'; close.textContent = '×'; close.setAttribute('aria-label', 'Закрыть сведения об офлайн-копии');
  const detailsToggle = document.createElement('button');
  detailsToggle.id = 'pwaDetailsToggle'; detailsToggle.textContent = 'Подробнее'; detailsToggle.setAttribute('aria-controls', 'pwaDetails');
  const details = document.createElement('p');
  details.id = 'pwaDetails'; details.hidden = true;
  const heading = document.createElement('div'), actions = document.createElement('div');
  heading.className = actions.className = 'pwa-row';
  heading.append(label, close); actions.append(button, retry, detailsToggle);
  panel.append(heading, actions, details); document.body.append(panel);
  document.getElementById('documentTabs').append(toggle);

  const mobile = window.matchMedia('(max-width:760px)');
  let screen = document.getElementById('homeScreen')?.classList.contains('hidden') ? 'editor' : 'home';
  let expanded = false;
  let preparing = false, confirmedReady = false, announceSuccess = false, displayedWorker, collapseTimer;
  const registrationDisplay = new WeakMap();
  function positionPanel() {
    const rect = toggle.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    panel.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)) + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - 110, rect.bottom + 7)) + 'px';
  }
  function layout() {
    const visible = !mobile.matches || screen === 'home';
    const host = document.getElementById(mobile.matches ? 'homePwaStatus' : 'documentTabs');
    if (host && toggle.parentNode !== host) host.append(toggle);
    toggle.hidden = !visible;
    panel.hidden = !visible || !expanded;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    detailsToggle.setAttribute('aria-expanded', String(!details.hidden));
    if (!panel.hidden) positionPanel();
  }
  document.addEventListener('karto-screen-change', event => { screen = event.detail.screen; expanded = false; layout(); });
  mobile.addEventListener('change', () => { expanded = false; layout(); });
  window.addEventListener('resize', layout);
  document.addEventListener('pointerdown', event => {
    if (expanded && !panel.contains(event.target) && !toggle.contains(event.target)) collapse();
  }, true);
  document.addEventListener('keydown', event => {
    if (expanded && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); collapse();
    }
  }, true);
  function collapse() {
    clearTimeout(collapseTimer); expanded = false; details.hidden = true;
    if (panel.contains(document.activeElement) && !toggle.hidden) toggle.focus();
    layout();
  }
  close.onclick = collapse;
  toggle.onclick = () => {
    if (!panel.hidden) { collapse(); return; }
    clearTimeout(collapseTimer); expanded = true; layout();
  };
  detailsToggle.onclick = () => { details.hidden = !details.hidden; layout(); };
  function notice(message, { detail = '', retryable = false, update = false, success = false } = {}) {
    clearTimeout(collapseTimer);
    label.textContent = label.title = message;
    details.textContent = detail; details.hidden = true; detailsToggle.hidden = !detail;
    retry.hidden = !retryable; button.hidden = !update;
    actions.hidden = !detail && !retryable && !update;
    const state = update ? 'update' : retryable ? 'error' : confirmedReady ? 'ready' : 'loading';
    toggle.dataset.state = state; toggle.dataset.ready = String(confirmedReady);
    toggle.title = message;
    toggle.setAttribute('aria-label', 'Офлайн: ' + message);
    // The panel is never opened automatically, including on success or error.
    layout();
    if (success && expanded) collapseTimer = setTimeout(collapse, 4000);
  }
  function failed(error) {
    notice(confirmedReady ? 'Не удалось обновить офлайн-копию' : 'Не удалось подготовить офлайн-копию', {
      retryable: true,
      detail: error.message + (confirmedReady ? '\nПрежняя рабочая копия сохранена.' : ''),
    });
  }
  function status(worker) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(Error('Проверка офлайн-копии не завершена')); }, 10000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
    });
  }
  async function start() {
    if (preparing) return;
    preparing = true; retry.disabled = true; displayedWorker = undefined;
    notice('Подготовка офлайн-версии…');
    let timer;
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Регистрация офлайн-копии не завершилась за 30 секунд. Повторите попытку.')), 30000); }),
      ]);
      clearTimeout(timer);
      announceSuccess = !confirmedReady && !navigator.serviceWorker.controller && !registration.active;
      if (registrationDisplay.has(registration)) {
        await Promise.race([
          registration.update(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Проверка обновления не завершилась за 30 секунд. Повторите попытку.')), 30000); }),
        ]);
        clearTimeout(timer);
        await waitForOfflineWorker(registration);
        await registrationDisplay.get(registration)();
        return;
      }
      let busy = false;
      async function display() {
        if (busy) return;
        const worker = navigator.serviceWorker.controller || registration.active;
        if (worker) {
          try {
            const result = await status(worker);
            const firstSuccess = !confirmedReady && result.ready && announceSuccess;
            confirmedReady = result.ready === true;
            panel.dataset.offlineReady = String(result.ready);
            panel.dataset.version = result.version;
            if (!registration.waiting && (displayedWorker !== worker || !result.ready)) {
              displayedWorker = worker;
              notice(result.ready ? (firstSuccess ? 'Офлайн-копия готова' : 'Готово к работе офлайн') : 'Офлайн-копия ещё не готова', {
                expanded: firstSuccess || !result.ready, retryable: !result.ready, success: firstSuccess,
              });
            }
          } catch (error) { failed(error); }
        }
        if (registration.waiting) {
          try {
            if (!(await status(registration.waiting)).ready) throw Error('Новая офлайн-копия не готова');
            notice('Доступна новая версия', { update: true });
          } catch (error) { failed(error); }
        }
      }
      function watchCandidate() {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          // A controller alone is not proof of a complete previous offline copy.
          if (worker.state === 'redundant') void display().then(() => failed(Error('Не удалось установить офлайн-копию. Проверьте сеть и SHA-256 ресурсов в консоли браузера.')));
          else if (worker.state === 'installed' || worker.state === 'activated') void display();
        });
      }
      registration.addEventListener('updatefound', watchCandidate);
      watchCandidate();
      navigator.serviceWorker.addEventListener('controllerchange', () => { void display(); });
      registrationDisplay.set(registration, display);
      // Detect deploys in long-lived editor sessions; failures leave the cache intact.
      const check = () => { if (navigator.onLine) void registration.update().catch(() => {}); };
      window.addEventListener('online', check);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 60 * 60 * 1000);
      button.onclick = async () => {
        const worker = registration.waiting;
        if (!worker || busy) return;
        busy = true; button.disabled = true;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:#0003;display:grid;place-items:center;color:white';
        overlay.textContent = 'Сохранение документов перед обновлением…';
        document.body.append(overlay);
        try {
          // Existing snapshot barrier confirms active and inactive documents, fonts,
          // settings and pending resource work. A failure must postpone the update.
          await prepare();
          if (!(await status(worker)).ready) throw Error('Новая офлайн-копия не готова');
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(Error('Обновление отложено: нет подтверждения активации')); }, 15000);
            function changed() {
              if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); }
              else if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(Error('Обновление недоступно')); }
            }
            worker.addEventListener('statechange', changed);
            worker.postMessage({ type: 'ACTIVATE_UPDATE' }); changed();
          });
          location.reload();
        } catch (error) {
          resume(); overlay.remove(); busy = false; button.disabled = false;
          notice('Обновление отложено', { update: true, detail: error.message });
        }
      };
      // Confirm any working version before watching a candidate installation.
      if (registration.active || registration.waiting) await display();
      if (registration.installing || (!registration.active && !registration.waiting)) {
        await waitForOfflineWorker(registration);
        await display();
      }
    } catch (error) { failed(error); }
    finally { clearTimeout(timer); preparing = false; retry.disabled = false; }
  }
  retry.onclick = () => { void start(); };
  void start();
}
