const TP_ROW_HEIGHT = 44;
const TP_VISIBLE_ROWS = 5;
const TP_PAD = (TP_ROW_HEIGHT * TP_VISIBLE_ROWS - TP_ROW_HEIGHT) / 2;

function formatTime12(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function to24Hour(h12, minute, ampm) {
  let h = h12 % 12;
  if (ampm === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function tpBuildColumn(id, items) {
  return `<div class="tp-col" id="${id}">${items.map(v => `<div class="tp-item">${v}</div>`).join('')}</div>`;
}

function tpSetupColumn(col, count, initialIndex, onSettle) {
  col.scrollTop = initialIndex * TP_ROW_HEIGHT;
  let current = initialIndex;

  function refreshFade() {
    Array.from(col.children).forEach((item, i) => {
      const dist = Math.abs(i - current);
      item.style.opacity = dist === 0 ? '1' : dist === 1 ? '0.55' : dist === 2 ? '0.3' : '0.15';
      item.style.fontWeight = dist === 0 ? '500' : '400';
    });
  }
  refreshFade();

  // Click any visible value to jump straight to it, instead of only scrolling.
  Array.from(col.children).forEach((item, i) => {
    item.addEventListener('click', () => {
      col.scrollTo({ top: i * TP_ROW_HEIGHT, behavior: 'smooth' });
    });
  });

  let settleTimer = null;
  col.addEventListener('scroll', () => {
    const idx = Math.max(0, Math.min(count - 1, Math.round(col.scrollTop / TP_ROW_HEIGHT)));
    if (idx !== current) { current = idx; refreshFade(); }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const settledIdx = Math.max(0, Math.min(count - 1, Math.round(col.scrollTop / TP_ROW_HEIGHT)));
      col.scrollTo({ top: settledIdx * TP_ROW_HEIGHT, behavior: 'smooth' });
      current = settledIdx;
      refreshFade();
      onSettle(settledIdx);
    }, 120);
  }, { passive: true });

  return { getIndex: () => current };
}

// currentValue: 'HH:MM' 24h string or null. onConfirm(value) called with 'HH:MM' or null (cleared).
function openTimePicker(currentValue, dateLabel, onConfirm) {
  const now = new Date();
  let h24 = currentValue ? parseInt(currentValue.split(':')[0], 10) : now.getHours();
  let min = currentValue ? parseInt(currentValue.split(':')[1], 10) : Math.round(now.getMinutes() / 5) * 5 % 60;
  let ampmVal = h24 >= 12 ? 'PM' : 'AM';
  let h12Val = h24 % 12 === 0 ? 12 : h24 % 12;

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  const ampms = ['AM', 'PM'];

  const overlay = document.createElement('div');
  overlay.className = 'time-picker-overlay';
  overlay.innerHTML = `
    <div class="time-picker-sheet">
      <div class="time-picker-handle"></div>
      <div class="time-picker-title" id="tp-title">${dateLabel ? dateLabel + ' – ' : ''}${formatTime12(to24Hour(h12Val, min, ampmVal))}</div>
      <div class="time-picker-columns">
        <div class="tp-highlight-band"></div>
        ${tpBuildColumn('tp-hour', hours)}
        ${tpBuildColumn('tp-min', minutes)}
        ${tpBuildColumn('tp-ampm', ampms)}
      </div>
      <div class="btn-row" style="padding:0 16px;">
        <button type="button" class="btn" id="tp-clear">Clear</button>
        <button type="button" class="btn btn-primary" id="tp-confirm">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const title = overlay.querySelector('#tp-title');
  function refreshTitle() {
    title.textContent = `${dateLabel ? dateLabel + ' – ' : ''}${formatTime12(to24Hour(h12Val, min, ampmVal))}`;
  }

  const hourCol = overlay.querySelector('#tp-hour');
  const minCol = overlay.querySelector('#tp-min');
  const ampmCol = overlay.querySelector('#tp-ampm');

  tpSetupColumn(hourCol, hours.length, h12Val - 1, idx => { h12Val = hours[idx]; refreshTitle(); });
  tpSetupColumn(minCol, minutes.length, min, idx => { min = idx; refreshTitle(); });
  tpSetupColumn(ampmCol, ampms.length, ampmVal === 'AM' ? 0 : 1, idx => { ampmVal = ampms[idx]; refreshTitle(); });

  function close() {
    overlay.remove();
  }
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#tp-confirm').addEventListener('click', () => {
    onConfirm(to24Hour(h12Val, min, ampmVal));
    close();
  });
  overlay.querySelector('#tp-clear').addEventListener('click', () => {
    onConfirm(null);
    close();
  });
}
