function formatDateShort(iso) {
  if (!iso) return '';
  return parseISO(iso).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateRangeShort(startIso, endIso) {
  if (!endIso || endIso === startIso) return formatDateShort(startIso);
  // No weekday here (unlike formatDateShort) -- with both endpoints of a
  // range, that's too long for the date button and runs off the edge.
  const noWeekday = iso => parseISO(iso).toLocaleDateString('default', { month: 'short', day: 'numeric' });
  return `${noWeekday(startIso)} – ${noWeekday(endIso)}`;
}

function formatDateNumeric(iso) {
  const d = parseISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// startValue/endValue: 'YYYY-MM-DD' or null. Tap a date to set it as the start
// (clearing any end); tap a different date afterward to extend through it.
// Nothing closes the picker except Done (or tapping outside to cancel), so
// the range can be reviewed and re-picked before it's committed.
// onConfirm(startIso, endIsoOrNull) called once, when Done is tapped.
// Pass { single: true } for a plain one-date picker (no range, no Done —
// tapping a date confirms and closes immediately), e.g. for a list of
// independent custom dates rather than a start/through span.
function openDatePicker(startValue, endValue, onConfirm, opts) {
  const single = !!(opts && opts.single);
  let rangeStart = startValue || formatISO(new Date());
  let rangeEnd = single ? null : (endValue && endValue > rangeStart ? endValue : null);
  let phase = 'start'; // 'start': next tap sets a fresh start date. 'end': next tap extends through it.

  const start = parseISO(rangeStart);
  let viewYear = start.getFullYear();
  let viewMonth = start.getMonth();

  const overlay = document.createElement('div');
  overlay.className = 'time-picker-overlay';
  overlay.innerHTML = `
    <div class="time-picker-sheet date-picker-sheet">
      <div class="time-picker-handle"></div>
      <div class="date-picker-nav">
        <button type="button" class="icon-btn" id="dp-prev">${icon('chevron-left')}</button>
        <span class="date-picker-month-label" id="dp-month-label"></span>
        <button type="button" class="icon-btn" id="dp-next">${icon('chevron-right')}</button>
      </div>
      <div class="date-picker-weekdays">
        <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
      </div>
      <div class="date-picker-grid" id="dp-grid"></div>
      <p class="muted date-picker-hint${single ? ' hidden' : ''}" id="dp-hint"></p>
      <button type="button" class="btn btn-primary${single ? ' hidden' : ''}" id="dp-done" style="width:100%;margin-top:6px;">Done</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const monthLabel = overlay.querySelector('#dp-month-label');
  const grid = overlay.querySelector('#dp-grid');
  const hint = overlay.querySelector('#dp-hint');
  const todayStr = formatISO(new Date());

  function render() {
    monthLabel.textContent = new Date(viewYear, viewMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    hint.textContent = phase === 'start'
      ? 'Tap a date'
      : (rangeEnd ? 'Tap Done to confirm, or tap a date to change the range' : 'Tap another date to extend through it, or tap Done');
    grid.innerHTML = '';
    getGridDates(viewYear, viewMonth).forEach(d => {
      const ds = formatISO(d);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'dp-day'
        + (d.getMonth() !== viewMonth ? ' outside' : '')
        + (ds === rangeStart ? ' range-start' : '')
        + (ds === rangeEnd ? ' range-end' : '')
        + (rangeEnd && ds > rangeStart && ds < rangeEnd ? ' in-range' : '')
        + (ds === todayStr ? ' today' : '');
      cell.textContent = d.getDate();
      cell.addEventListener('click', () => {
        if (single) {
          onConfirm(ds, null);
          overlay.remove();
          return;
        }
        if (phase === 'start') {
          rangeStart = ds;
          rangeEnd = null;
          phase = 'end';
        } else if (ds === rangeStart) {
          rangeEnd = null;
        } else if (ds < rangeStart) {
          rangeEnd = rangeStart;
          rangeStart = ds;
        } else {
          rangeEnd = ds;
        }
        render();
      });
      grid.appendChild(cell);
    });
  }
  render();

  overlay.querySelector('#dp-prev').addEventListener('click', () => {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    render();
  });
  overlay.querySelector('#dp-next').addEventListener('click', () => {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  });
  overlay.querySelector('#dp-done').addEventListener('click', () => {
    onConfirm(rangeStart, rangeEnd);
    overlay.remove();
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
}

// selectedDates: array of 'YYYY-MM-DD'. Tap any date to toggle it on/off;
// nothing closes the picker except Done (or tapping outside to cancel).
// onConfirm(datesArray) called once, when Done is tapped. anchorDate (optional)
// picks which month to open to when selectedDates is empty.
function openMultiDatePicker(selectedDates, onConfirm, anchorDate) {
  const selected = new Set(selectedDates || []);
  const first = selected.size ? Array.from(selected).sort()[0] : (anchorDate || formatISO(new Date()));
  const start = parseISO(first);
  let viewYear = start.getFullYear();
  let viewMonth = start.getMonth();

  const overlay = document.createElement('div');
  overlay.className = 'time-picker-overlay';
  overlay.innerHTML = `
    <div class="time-picker-sheet date-picker-sheet">
      <div class="time-picker-handle"></div>
      <div class="date-picker-nav">
        <button type="button" class="icon-btn" id="dp-prev">${icon('chevron-left')}</button>
        <span class="date-picker-month-label" id="dp-month-label"></span>
        <button type="button" class="icon-btn" id="dp-next">${icon('chevron-right')}</button>
      </div>
      <div class="date-picker-weekdays">
        <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
      </div>
      <div class="date-picker-grid" id="dp-grid"></div>
      <p class="muted date-picker-hint" id="dp-hint">Tap dates to select or deselect</p>
      <button type="button" class="btn btn-primary" id="dp-done" style="width:100%;margin-top:6px;">Done</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const monthLabel = overlay.querySelector('#dp-month-label');
  const grid = overlay.querySelector('#dp-grid');
  const todayStr = formatISO(new Date());

  function render() {
    monthLabel.textContent = new Date(viewYear, viewMonth, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    grid.innerHTML = '';
    getGridDates(viewYear, viewMonth).forEach(d => {
      const ds = formatISO(d);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'dp-day'
        + (d.getMonth() !== viewMonth ? ' outside' : '')
        + (selected.has(ds) ? ' multi-selected' : '')
        + (ds === todayStr ? ' today' : '');
      cell.textContent = d.getDate();
      cell.addEventListener('click', () => {
        if (selected.has(ds)) selected.delete(ds); else selected.add(ds);
        render();
      });
      grid.appendChild(cell);
    });
  }
  render();

  overlay.querySelector('#dp-prev').addEventListener('click', () => {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    render();
  });
  overlay.querySelector('#dp-next').addEventListener('click', () => {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    render();
  });
  overlay.querySelector('#dp-done').addEventListener('click', () => {
    onConfirm(Array.from(selected).sort());
    overlay.remove();
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
}
