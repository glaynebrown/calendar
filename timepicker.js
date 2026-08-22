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

// Repeating the value list several times (for loop columns) gives room to
// scroll several screens in either direction before ever visibly reaching
// an edge; tpSetupColumn periodically re-centers back into the middle copy
// well before that room runs out.
const TP_LOOP_COPIES = 5;

function tpBuildColumn(id, items, loop) {
  const rendered = loop ? Array(TP_LOOP_COPIES).fill(items).flat() : items;
  return `<div class="tp-col" id="${id}">${rendered.map(v => `<div class="tp-item">${v}</div>`).join('')}</div>`;
}

// loop: wraps the column so scrolling past either end continues around
// (12 -> 1, 59 -> 00) instead of stopping dead. Implemented by rendering
// the value list repeated (see tpBuildColumn) and, once scrolling settles,
// silently jumping back to the equivalent row in the middle copy -- an
// un-animated scrollTop assignment, invisible since every copy renders the
// same values at the same relative position, so nothing visibly moves.
function tpSetupColumn(col, realCount, initialIndex, onSettle, loop) {
  const totalCount = loop ? realCount * TP_LOOP_COPIES : realCount;
  const middleOffset = loop ? realCount * Math.floor(TP_LOOP_COPIES / 2) : 0;
  let current = middleOffset + initialIndex;
  col.scrollTop = current * TP_ROW_HEIGHT;

  // Only the handful of items within 2 rows of the old and new center ever
  // have a distinct opacity/weight (anything farther is uniformly at the
  // faintest step) -- rewriting every child's style on every scroll tick
  // was the actual cause of the choppy scroll, especially on the 300-item
  // (60 minutes x 5 looped copies) minutes column. Only touch that bounded
  // window instead.
  function refreshFade(prevCurrent) {
    const lo = Math.max(0, Math.min(current, prevCurrent) - 2);
    const hi = Math.min(col.children.length - 1, Math.max(current, prevCurrent) + 2);
    for (let i = lo; i <= hi; i++) {
      const item = col.children[i];
      const dist = Math.abs(i - current);
      item.style.opacity = dist === 0 ? '1' : dist === 1 ? '0.55' : dist === 2 ? '0.3' : '0.15';
      item.style.fontWeight = dist === 0 ? '500' : '400';
    }
  }
  refreshFade(current);

  // Click any visible value to jump straight to it, instead of only scrolling.
  Array.from(col.children).forEach((item, i) => {
    item.addEventListener('click', () => {
      col.scrollTo({ top: i * TP_ROW_HEIGHT, behavior: 'smooth' });
    });
  });

  let settleTimer = null;
  col.addEventListener('scroll', () => {
    const idx = Math.max(0, Math.min(totalCount - 1, Math.round(col.scrollTop / TP_ROW_HEIGHT)));
    if (idx !== current) { const prev = current; current = idx; refreshFade(prev); }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const settledIdx = Math.max(0, Math.min(totalCount - 1, Math.round(col.scrollTop / TP_ROW_HEIGHT)));
      col.scrollTo({ top: settledIdx * TP_ROW_HEIGHT, behavior: 'smooth' });
      const prevSettle = current;
      current = settledIdx;
      refreshFade(prevSettle);
      const realIdx = settledIdx % realCount;
      onSettle(realIdx);

      if (loop) {
        // Wait for the smooth snap above to finish before silently
        // recentering -- jumping mid-animation would cut the snap short.
        setTimeout(() => {
          const recentered = middleOffset + realIdx;
          if (recentered !== current) {
            col.scrollTop = recentered * TP_ROW_HEIGHT;
            const prevRecenter = current;
            current = recentered;
            refreshFade(prevRecenter);
          }
        }, 350);
      }
    }, 120);
  }, { passive: true });

  return { getIndex: () => (loop ? current % realCount : current) };
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
        ${tpBuildColumn('tp-hour', hours, true)}
        ${tpBuildColumn('tp-min', minutes, true)}
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

  tpSetupColumn(hourCol, hours.length, h12Val - 1, idx => { h12Val = hours[idx]; refreshTitle(); }, true);
  tpSetupColumn(minCol, minutes.length, min, idx => { min = idx; refreshTitle(); }, true);
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
