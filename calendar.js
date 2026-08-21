/* Date helpers (local-time, no UTC shifting) */
function pad2(n) { return String(n).padStart(2, '0'); }
function formatISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addToDate(date, freq, interval) {
  const d = new Date(date);
  if (freq === 'daily') d.setDate(d.getDate() + interval);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7 * interval);
  else if (freq === 'monthly') d.setMonth(d.getMonth() + interval);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + interval);
  return d;
}
function getGridDates(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const dates = [];
  for (let i = 0; i < totalCells; i++) {
    dates.push(new Date(year, month, 1 - startOffset + i));
  }
  return dates;
}
// Sunday-through-Saturday week containing the given date.
function getWeekDates(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return dates;
}

function expandOccurrences(event, rangeStartStr, rangeEndStr) {
  const rangeStart = parseISO(rangeStartStr);
  const rangeEnd = parseISO(rangeEndStr);
  const exceptions = event.exceptions || [];
  const results = [];

  if (event.type === 'custom') {
    (event.dates || []).forEach(ds => {
      const d = parseISO(ds);
      if (d >= rangeStart && d <= rangeEnd && !exceptions.includes(ds)) results.push(ds);
    });
    return results;
  }

  if (!event.recurrence) {
    const d = parseISO(event.date);
    if (d >= rangeStart && d <= rangeEnd && !exceptions.includes(event.date)) results.push(event.date);
    return results;
  }

  const rule = event.recurrence;
  const until = rule.until ? parseISO(rule.until) : null;
  const maxCount = rule.count || Infinity;
  let cur = parseISO(event.date);
  let n = 0;
  let iterations = 0;
  while (n < maxCount && iterations < 3000) {
    if (until && cur > until) break;
    if (cur > rangeEnd) break;
    if (cur >= rangeStart) {
      const ds = formatISO(cur);
      if (!exceptions.includes(ds)) results.push(ds);
    }
    n++;
    iterations++;
    cur = addToDate(cur, rule.freq, rule.interval || 1);
  }
  return results;
}

function compareEventOrder(a, b) {
  return (a.time || '').localeCompare(b.time || '') || (a.order || 0) - (b.order || 0);
}

function isEventVisible(event, currentUserId, viewPeopleIds) {
  const participantIds = event.participantIds || [event.ownerId];
  if (!participantIds.some(id => viewPeopleIds.includes(id))) return false;
  if (participantIds.includes(currentUserId)) return true;
  if (event.visibility === 'shared') return true;
  if (event.visibility === 'custom') return (event.customPeople || []).includes(currentUserId);
  return false;
}

const PLANNER_WIDGET_LABELS = {
  events: "Today's Events", todo: 'To-Do List', notes: 'Notes', priorities: 'Priorities',
  mood: 'Mood Tracker', habits: 'Habit Tracker', memories: 'Memories', photos: 'Photo Board',
  gratitude: 'Gratitude', goals: 'Goals', moodboard: 'Mood Board', drawing: 'Drawing/iPad',
};
const PLANNER_TEXT_TYPES = ['notes', 'memories', 'gratitude'];
const PLANNER_TEXT_PLACEHOLDERS = {
  notes: 'Write something...', memories: 'What made today memorable?', gratitude: 'What are you grateful for today?',
};
const PLANNER_MOOD_OPTIONS = ['mood-very-happy', 'mood-happy', 'mood-neutral', 'mood-sad', 'mood-very-sad', 'mood-angry'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_OPTIONS = MONTH_NAMES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');

const HOLIDAY_COLOR = '#BA7517';
// Fixed dates repeat every year on the same month/day. nth-weekday and
// last-weekday cover the floating US holidays (weekday: 0=Sun..6=Sat).
const HOLIDAY_DEFS = [
  { id: 'new-years-day', name: "New Year's Day", emoji: '🎉', rule: { type: 'fixed', month: 1, day: 1 } },
  { id: 'mlk-day', name: 'Martin Luther King Jr. Day', emoji: '✊', rule: { type: 'nth-weekday', month: 1, weekday: 1, n: 3 } },
  { id: 'valentines-day', name: "Valentine's Day", emoji: '💘', rule: { type: 'fixed', month: 2, day: 14 } },
  { id: 'presidents-day', name: "Presidents' Day", emoji: '🇺🇸', rule: { type: 'nth-weekday', month: 2, weekday: 1, n: 3 } },
  { id: 'st-patricks-day', name: "St. Patrick's Day", emoji: '☘️', rule: { type: 'fixed', month: 3, day: 17 } },
  { id: 'easter', name: 'Easter', emoji: '🐰', rule: { type: 'easter' } },
  { id: 'memorial-day', name: 'Memorial Day', emoji: '🇺🇸', rule: { type: 'last-weekday', month: 5, weekday: 1 } },
  { id: 'juneteenth', name: 'Juneteenth', emoji: '✊', rule: { type: 'fixed', month: 6, day: 19 } },
  { id: 'independence-day', name: 'Independence Day', emoji: '🎆', rule: { type: 'fixed', month: 7, day: 4 } },
  { id: 'labor-day', name: 'Labor Day', emoji: '🛠️', rule: { type: 'nth-weekday', month: 9, weekday: 1, n: 1 } },
  { id: 'halloween', name: 'Halloween', emoji: '🎃', rule: { type: 'fixed', month: 10, day: 31 } },
  { id: 'veterans-day', name: 'Veterans Day', emoji: '🎖️', rule: { type: 'fixed', month: 11, day: 11 } },
  { id: 'thanksgiving', name: 'Thanksgiving', emoji: '🦃', rule: { type: 'nth-weekday', month: 11, weekday: 4, n: 4 } },
  { id: 'christmas-eve', name: 'Christmas Eve', emoji: '🎄', rule: { type: 'fixed', month: 12, day: 24 } },
  { id: 'christmas', name: 'Christmas', emoji: '🎄', rule: { type: 'fixed', month: 12, day: 25 } },
  { id: 'new-years-eve', name: "New Year's Eve", emoji: '🥂', rule: { type: 'fixed', month: 12, day: 31 } },
];

function ordinal(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}

function computeHolidayDate(rule, year) {
  if (rule.type === 'fixed') return new Date(year, rule.month - 1, rule.day);
  if (rule.type === 'nth-weekday') {
    const firstWeekday = new Date(year, rule.month - 1, 1).getDay();
    const dayOffset = (rule.weekday - firstWeekday + 7) % 7;
    return new Date(year, rule.month - 1, 1 + dayOffset + (rule.n - 1) * 7);
  }
  if (rule.type === 'last-weekday') {
    const lastDate = new Date(year, rule.month, 0).getDate();
    const lastWeekday = new Date(year, rule.month - 1, lastDate).getDay();
    const diff = (lastWeekday - rule.weekday + 7) % 7;
    return new Date(year, rule.month - 1, lastDate - diff);
  }
  if (rule.type === 'easter') {
    // Meeus/Jones/Butcher algorithm for the Gregorian Easter date.
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
  return null;
}

const Calendar = {
  currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  currentDate: new Date(),
  viewMode: 'month', // 'month' | 'week' | 'day-everyone' | 'planner'
  plannerFlipDelta: null, // set by shiftPeriod right before a planner render, so it knows which way to flip

  init() {
    this.viewMode = Store.getDefaultCalendarView(Store.getCurrentUserId());
    document.getElementById('prev-month').addEventListener('click', () => this.shiftPeriod(-1));
    document.getElementById('next-month').addEventListener('click', () => this.shiftPeriod(1));
    document.getElementById('hamburger-btn').addEventListener('click', () => this.toggleViewMenu());
    document.getElementById('viewmode-btn').addEventListener('click', () => this.toggleViewModeMenu());
    document.getElementById('search-btn').addEventListener('click', () => this.toggleSearchPanel());
    document.getElementById('month-label').addEventListener('click', () => this.openMonthThemeModal());

    document.addEventListener('click', e => {
      const menu = document.getElementById('view-menu');
      const hamburgerBtn = document.getElementById('hamburger-btn');
      if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !hamburgerBtn.contains(e.target)) {
        menu.classList.add('hidden');
      }
      const viewModeMenu = document.getElementById('viewmode-menu');
      const viewModeBtn = document.getElementById('viewmode-btn');
      if (!viewModeMenu.classList.contains('hidden') && !viewModeMenu.contains(e.target) && !viewModeBtn.contains(e.target)) {
        viewModeMenu.classList.add('hidden');
      }
      const panel = document.getElementById('search-panel');
      const searchBtn = document.getElementById('search-btn');
      if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !searchBtn.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });

    const grid = document.getElementById('calendar-grid');
    let touchStartX = null;
    grid.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    grid.addEventListener('touchend', e => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) this.shiftPeriod(dx < 0 ? 1 : -1);
      touchStartX = null;
    }, { passive: true });

    this.render();
  },

  getRelevantMonthIndex() {
    return this.viewMode === 'month' ? this.currentMonth.getMonth() : this.currentDate.getMonth();
  },

  toggleViewModeMenu() {
    document.getElementById('view-menu').classList.add('hidden');
    document.getElementById('search-panel').classList.add('hidden');
    const menu = document.getElementById('viewmode-menu');
    const willShow = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    if (willShow) this.renderViewModeMenu();
  },

  renderViewModeMenu() {
    const menu = document.getElementById('viewmode-menu');
    menu.innerHTML = '';
    const options = [
      { id: 'month', label: 'Month' },
      { id: 'week', label: 'Week' },
      { id: 'day-everyone', label: 'Day (everyone)' },
      { id: 'planner', label: 'Planner' },
    ];
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'menu-item' + (this.viewMode === opt.id ? ' selected' : '');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        menu.classList.add('hidden');
        this.setViewMode(opt.id);
      });
      menu.appendChild(btn);
    });
  },

  setViewMode(mode) {
    if (mode !== 'month' && this.viewMode === 'month') {
      this.currentDate = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth(), 1);
    } else if (mode === 'month' && this.viewMode !== 'month') {
      this.currentMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
    }
    this.viewMode = mode;
    this.render();
  },

  updateHeaderLabel() {
    const label = document.getElementById('month-label');
    if (this.viewMode === 'month') {
      label.textContent = this.currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    } else if (this.viewMode === 'week') {
      const weekDates = getWeekDates(this.currentDate);
      const start = weekDates[0], end = weekDates[6];
      const startStr = start.toLocaleDateString('default', { month: 'short', day: 'numeric' });
      const endStr = end.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
      label.textContent = `${startStr} – ${endStr}`;
    } else {
      label.textContent = this.currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
    }
  },

  getEventsForDate(dateStr, peopleIds, categories, categoryFilter) {
    const userId = Store.getCurrentUserId();
    const events = Store.getEvents().filter(event => {
      if (!isEventVisible(event, userId, peopleIds)) return false;
      if (categories && categories.length && !categories.includes(event.category)) return false;
      if (categoryFilter && event.category !== categoryFilter) return false;
      if (event.type === 'single' && event.endDate && event.endDate > event.date) {
        return event.date <= dateStr && event.endDate >= dateStr;
      }
      return expandOccurrences(event, dateStr, dateStr).length > 0;
    }).sort(compareEventOrder);
    return [
      ...this.getHolidayOccurrences(dateStr, userId),
      ...this.getBirthdayOccurrences(dateStr, peopleIds),
      ...events,
    ];
  },

  // Birthdays aren't real events (no time/category/repeat rules) -- they're
  // synthesized on the fly from each visible person's birthday list and
  // merged in wherever getEventsForDate is used, so every view picks them up
  // for free. Not affected by category filters, since they aren't categorized.
  getBirthdayOccurrences(dateStr, peopleIds) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return peopleIds
      .flatMap(ownerId => Store.getBirthdays(ownerId).map(b => ({ ...b, ownerId })))
      .filter(b => b.month === m && b.day === d)
      .map(b => ({
        id: `bday-${b.id}-${y}`,
        birthdayId: b.id,
        ownerId: b.ownerId,
        isBirthday: true,
        color: b.color || null,
        category: null,
        time: null,
        date: dateStr,
        title: b.year ? `🎂 ${b.name}'s ${ordinal(y - b.year)}` : `🎂 ${b.name}'s Birthday`,
      }));
  },

  // Holidays are a personal display preference, not owned data -- just which
  // built-in defs this user has checked on. Each floating holiday's actual
  // date is computed for dateStr's year and compared directly.
  getHolidayOccurrences(dateStr, userId) {
    const enabled = Store.getEnabledHolidays(userId);
    if (!enabled.length) return [];
    const year = parseInt(dateStr.split('-')[0], 10);
    const color = Store.getHolidayColor(userId) || HOLIDAY_COLOR;
    return HOLIDAY_DEFS
      .filter(h => enabled.includes(h.id))
      .filter(h => formatISO(computeHolidayDate(h.rule, year)) === dateStr)
      .map(h => ({
        id: `holiday-${h.id}-${year}`,
        holidayId: h.id,
        isHoliday: true,
        color,
        category: null,
        time: null,
        date: dateStr,
        title: `${h.emoji} ${h.name}`,
      }));
  },

  // Real events are colored by category (yours) or by person; birthdays and
  // holidays can carry their own fixed color that overrides both. Returns
  // null when the user has turned off event coloring in Settings, so every
  // render site falls back to plain, uncolored text.
  colorForEvent(ev, userId) {
    if (!Store.getShowEventColors(userId)) return null;
    if (ev.color) return ev.color;
    return (ev.ownerId === userId && ev.category)
      ? Store.categoryColorFor(userId, ev.category)
      : Store.colorFor(userId, ev.ownerId);
  },

  shiftPeriod(delta) {
    if (this.viewMode === 'month') {
      this.currentMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + delta, 1);
    } else if (this.viewMode === 'week') {
      this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), this.currentDate.getDate() + delta * 7);
    } else {
      this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), this.currentDate.getDate() + delta);
    }
    if (this.viewMode === 'planner') this.plannerFlipDelta = delta;
    this.render();
  },

  toggleViewMenu() {
    document.getElementById('search-panel').classList.add('hidden');
    document.getElementById('viewmode-menu').classList.add('hidden');
    const menu = document.getElementById('view-menu');
    const willShow = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    if (willShow) this.renderViewMenu();
  },

  renderViewMenu() {
    const userId = Store.getCurrentUserId();
    const menu = document.getElementById('view-menu');
    menu.innerHTML = '';
    if (Store.getViewMode(userId) === 'checklist') this.renderChecklistPicker(menu, userId);
    else this.renderNamedViewPicker(menu, userId);
  },

  // Shared "Category" section header: label + add-category button/inline form, used by both picker modes.
  renderCategoryHeader(menu) {
    const label2 = document.createElement('div');
    label2.className = 'menu-section-label';
    label2.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding-right:6px;';
    label2.innerHTML = `<span>Category</span>`;
    const addCatBtn = document.createElement('button');
    addCatBtn.type = 'button';
    addCatBtn.className = 'icon-btn';
    addCatBtn.setAttribute('aria-label', 'Add category');
    addCatBtn.style.padding = '2px';
    addCatBtn.innerHTML = icon('plus');
    addCatBtn.querySelector('svg').style.cssText = 'width:14px;height:14px;';
    label2.appendChild(addCatBtn);
    menu.appendChild(label2);

    const addRow = document.createElement('div');
    addRow.className = 'hidden';
    addRow.style.cssText = 'display:flex; gap:6px; padding:4px 10px 8px;';
    addRow.innerHTML = `
      <input type="text" id="vm-new-category" placeholder="Category name" style="flex:1; padding:6px 8px; border-radius:8px; border:0.5px solid var(--border-strong); background:var(--surface-2); color:var(--text); font-size:16px;">
      <button type="button" class="btn" style="padding:4px 10px;" id="vm-new-category-add">Add</button>
    `;
    menu.appendChild(addRow);
    addCatBtn.addEventListener('click', () => {
      addRow.classList.toggle('hidden');
      if (!addRow.classList.contains('hidden')) addRow.querySelector('#vm-new-category').focus();
    });
    function commitNewCategory() {
      const input = addRow.querySelector('#vm-new-category');
      const name = input.value.trim();
      if (!name) return;
      Store.addCategory(name);
      input.value = '';
      addRow.classList.add('hidden');
      Calendar.renderViewMenu();
    }
    addRow.querySelector('#vm-new-category-add').addEventListener('click', commitNewCategory);
    addRow.querySelector('#vm-new-category').addEventListener('keydown', e => {
      if (e.key === 'Enter') commitNewCategory();
    });
  },

  renderManageCategoriesLink(menu) {
    if (!Store.getCategories().length) return;
    const manageCatBtn = document.createElement('button');
    manageCatBtn.className = 'menu-item';
    manageCatBtn.style.color = 'var(--accent)';
    manageCatBtn.textContent = 'Manage categories';
    manageCatBtn.addEventListener('click', () => { menu.classList.add('hidden'); this.openManageCategoriesModal(); });
    menu.appendChild(manageCatBtn);
  },

  renderNamedViewPicker(menu, userId) {
    const views = Store.getViews(userId);
    const activeViewId = Store.getActiveViewId(userId);
    const activeCategory = Store.getCategoryFilter(userId);
    const categories = Store.getCategories();

    const label1 = document.createElement('div');
    label1.className = 'menu-section-label';
    label1.textContent = 'View';
    menu.appendChild(label1);

    views.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'menu-item' + (v.id === activeViewId ? ' selected' : '');
      btn.textContent = v.name;
      btn.addEventListener('click', () => {
        Store.setActiveViewId(userId, v.id);
        menu.classList.add('hidden');
        this.render();
      });
      menu.appendChild(btn);
    });

    const manageBtn = document.createElement('button');
    manageBtn.className = 'menu-item';
    manageBtn.style.color = 'var(--accent)';
    manageBtn.textContent = 'Manage views';
    manageBtn.addEventListener('click', () => { menu.classList.add('hidden'); this.openManageViewsModal(); });
    menu.appendChild(manageBtn);

    const div = document.createElement('div');
    div.className = 'menu-divider';
    menu.appendChild(div);

    this.renderCategoryHeader(menu);

    const allBtn = document.createElement('button');
    allBtn.className = 'menu-item' + (activeCategory === '' ? ' selected' : '');
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => { Store.setCategoryFilter(userId, ''); menu.classList.add('hidden'); this.render(); });
    menu.appendChild(allBtn);

    categories.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'menu-item-row';

      const btn = document.createElement('button');
      btn.className = 'menu-item' + (activeCategory === cat ? ' selected' : '');
      const dotColor = Store.categoryColorFor(userId, cat);
      btn.innerHTML = `<span class="menu-item-inner"><span class="cat-dot" style="background:${dotColor}"></span>${escapeAttr(cat)}</span>`;
      btn.addEventListener('click', () => { Store.setCategoryFilter(userId, cat); menu.classList.add('hidden'); this.render(); });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn';
      editBtn.setAttribute('aria-label', `Edit ${cat}`);
      editBtn.innerHTML = icon('pencil');
      editBtn.querySelector('svg').style.cssText = 'width:14px;height:14px;';
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        menu.classList.add('hidden');
        this.openEditCategoryModal(cat);
      });

      row.appendChild(btn);
      row.appendChild(editBtn);
      menu.appendChild(row);
    });

    this.renderManageCategoriesLink(menu);
  },

  renderChecklistPicker(menu, userId) {
    const people = Store.getKnownPeople(userId);
    const categories = Store.getCategories();
    const filter = Store.getChecklistFilter(userId);

    const label1 = document.createElement('div');
    label1.className = 'menu-section-label';
    label1.textContent = 'People';
    menu.appendChild(label1);

    people.forEach(p => {
      const row = document.createElement('label');
      row.className = 'menu-item checklist-item';
      const checked = filter.peopleIds.includes(p.id);
      row.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}><span>${escapeAttr(p.name)}</span>`;
      row.querySelector('input').addEventListener('change', e => {
        const current = Store.getChecklistFilter(userId);
        const peopleIds = e.target.checked
          ? [...current.peopleIds, p.id]
          : current.peopleIds.filter(id => id !== p.id);
        Store.setChecklistFilter(userId, { ...current, peopleIds });
        Calendar.render();
      });
      menu.appendChild(row);
    });

    const div = document.createElement('div');
    div.className = 'menu-divider';
    menu.appendChild(div);

    this.renderCategoryHeader(menu);

    categories.forEach(cat => {
      const row = document.createElement('div');
      row.className = 'menu-item-row';

      const label = document.createElement('label');
      label.className = 'menu-item checklist-item';
      const checked = filter.categories.length === 0 || filter.categories.includes(cat);
      const dotColor = Store.categoryColorFor(userId, cat);
      label.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}><span class="menu-item-inner"><span class="cat-dot" style="background:${dotColor}"></span>${escapeAttr(cat)}</span>`;
      label.querySelector('input').addEventListener('change', e => {
        const current = Store.getChecklistFilter(userId);
        const allCats = Store.getCategories();
        const base = current.categories.length === 0 ? allCats : current.categories;
        // categories:[] means "all" app-wide, so the last checked box can't be unchecked
        // (that would collapse to [] and flip the meaning back to "all" instead of "none").
        if (!e.target.checked && base.length === 1) { e.target.checked = true; return; }
        let next = e.target.checked ? Array.from(new Set([...base, cat])) : base.filter(c => c !== cat);
        if (next.length === allCats.length) next = [];
        Store.setChecklistFilter(userId, { ...current, categories: next });
        Calendar.render();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn';
      editBtn.setAttribute('aria-label', `Edit ${cat}`);
      editBtn.innerHTML = icon('pencil');
      editBtn.querySelector('svg').style.cssText = 'width:14px;height:14px;';
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        menu.classList.add('hidden');
        this.openEditCategoryModal(cat);
      });

      row.appendChild(label);
      row.appendChild(editBtn);
      menu.appendChild(row);
    });

    this.renderManageCategoriesLink(menu);
  },

  openManageCategoriesModal() {
    const userId = Store.getCurrentUserId();

    const body = `
      <div class="modal-header"><h2>Manage categories</h2><button class="modal-close" id="mc-close">${icon('x')}</button></div>
      <div id="mc-list"></div>
      <div class="field-row" style="margin-top:10px;">
        <input type="text" id="mc-new-name" placeholder="New category name">
        <button class="btn" id="mc-add" style="flex:0 0 auto;">Add</button>
      </div>
    `;
    openModal(body, root => {
      root.querySelector('#mc-close').addEventListener('click', closeModal);
      const listEl = root.querySelector('#mc-list');

      function renderList() {
        const cats = Store.getCategories();
        listEl.innerHTML = cats.length ? '' : '<p class="muted">No categories yet.</p>';
        cats.forEach(cat => {
          const row = document.createElement('div');
          row.className = 'color-swatch-row';
          row.innerHTML = `
            <input type="text" value="${escapeAttr(cat)}" style="flex:1; margin-right:8px; padding:7px 8px; border-radius:8px; border:0.5px solid var(--border-strong); background:var(--surface-2); color:var(--text);">
            <button type="button" class="btn btn-danger" style="padding:4px 10px;">Delete</button>
          `;
          const input = row.querySelector('input');
          const deleteBtn = row.querySelector('button');
          input.addEventListener('blur', () => {
            const newName = input.value.trim();
            if (newName && newName !== cat) {
              Store.renameCategory(cat, newName);
              renderList();
              Calendar.render();
            } else {
              input.value = cat;
            }
          });
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') input.blur();
          });
          deleteBtn.addEventListener('click', () => {
            Store.deleteCategory(cat);
            renderList();
            Calendar.render();
          });
          listEl.appendChild(row);
        });
      }
      renderList();

      root.querySelector('#mc-add').addEventListener('click', () => {
        const nameInput = root.querySelector('#mc-new-name');
        const name = nameInput.value.trim();
        if (!name) return;
        Store.addCategory(name);
        nameInput.value = '';
        renderList();
      });
    });
  },

  openEditCategoryModal(cat) {
    const userId = Store.getCurrentUserId();

    const body = `
      <div class="modal-header"><h2>Edit category</h2><button class="modal-close" id="ec-close">${icon('x')}</button></div>
      <div class="field">
        <label>Name</label>
        <input type="text" id="ec-name" value="${escapeAttr(cat)}">
      </div>
      <div class="field">
        <label>Color</label>
        <input type="color" id="ec-color" class="color-box" value="${Store.categoryColorFor(userId, cat)}">
      </div>
      <div class="btn-row">
        <button class="btn btn-danger" id="ec-delete">Delete category</button>
        <button class="btn btn-primary" id="ec-save">Save</button>
      </div>
    `;

    openModal(body, root => {
      root.querySelector('#ec-close').addEventListener('click', closeModal);

      root.querySelector('#ec-save').addEventListener('click', () => {
        const newName = root.querySelector('#ec-name').value.trim();
        const newColor = root.querySelector('#ec-color').value;
        const finalName = newName || cat;
        if (newName && newName !== cat) Store.renameCategory(cat, newName);
        Store.setCategoryColor(userId, finalName, newColor);
        closeModal();
        Calendar.render();
      });

      root.querySelector('#ec-delete').addEventListener('click', () => {
        Store.deleteCategory(cat);
        closeModal();
        Calendar.render();
      });
    });
  },

  openManageViewsModal() {
    const userId = Store.getCurrentUserId();
    const people = Store.getKnownPeople(userId);
    const categories = Store.getCategories();
    const customViews = Store.getViews(userId).filter(v => !v.builtIn);
    const defaultViewId = Store.getDefaultViewId(userId);
    const allViews = Store.getViews(userId);

    const body = `
      <div class="modal-header"><h2>Manage views</h2><button class="modal-close" id="mv-close">${icon('x')}</button></div>
      <div class="field">
        <label>Default view</label>
        <select id="mv-default">
          ${allViews.map(v => `<option value="${v.id}" ${v.id === defaultViewId ? 'selected' : ''}>${v.name}</option>`).join('')}
        </select>
      </div>
      <div class="settings-section">
        <h3>Your custom views</h3>
        <div id="mv-list"></div>
      </div>
      <div class="settings-section">
        <h3>Add a custom view</h3>
        <div class="field"><label>Name</label><input type="text" id="mv-name" placeholder="Me + Nick"></div>
        <label class="muted" style="display:block;margin-bottom:4px;">People</label>
        <div class="people-picker" id="mv-people">
          ${people.map(p => `<label><input type="checkbox" value="${p.id}"> ${p.name}</label>`).join('')}
        </div>
        <label class="muted" style="display:block;margin:10px 0 4px;">Categories (leave all unchecked for every category)</label>
        <div class="people-picker" id="mv-categories">
          ${categories.map(c => `<label><input type="checkbox" value="${escapeAttr(c)}"> ${c}</label>`).join('')}
        </div>
        <button class="btn" id="mv-add" style="margin-top:10px;">Add view</button>
      </div>
    `;
    openModal(body, root => {
      root.querySelector('#mv-close').addEventListener('click', closeModal);
      root.querySelector('#mv-default').addEventListener('change', e => Store.setDefaultViewId(userId, e.target.value));

      const listEl = root.querySelector('#mv-list');
      function renderList() {
        const views = Store.getViews(userId).filter(v => !v.builtIn);
        listEl.innerHTML = views.length ? '' : '<p class="muted">No custom views yet.</p>';
        views.forEach(v => {
          const row = document.createElement('div');
          row.className = 'color-swatch-row';
          row.innerHTML = `<span>${v.name}</span>`;
          const del = document.createElement('button');
          del.className = 'btn btn-danger';
          del.style.padding = '4px 10px';
          del.textContent = 'Delete';
          del.addEventListener('click', () => {
            Store.deleteCustomView(userId, v.id);
            renderList();
            Calendar.render();
          });
          row.appendChild(del);
          listEl.appendChild(row);
        });
      }
      renderList();

      root.querySelector('#mv-add').addEventListener('click', () => {
        const name = root.querySelector('#mv-name').value.trim();
        const peopleIds = Array.from(root.querySelectorAll('#mv-people input:checked')).map(i => i.value);
        const viewCategories = Array.from(root.querySelectorAll('#mv-categories input:checked')).map(i => i.value);
        if (!name || peopleIds.length === 0) return;
        Store.addCustomView(userId, { name, peopleIds, categories: viewCategories });
        root.querySelector('#mv-name').value = '';
        root.querySelectorAll('#mv-people input, #mv-categories input').forEach(i => i.checked = false);
        renderList();
      });
    });
  },

  toggleSearchPanel() {
    document.getElementById('view-menu').classList.add('hidden');
    document.getElementById('viewmode-menu').classList.add('hidden');
    const panel = document.getElementById('search-panel');
    const willShow = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (willShow) this.renderSearchPanel();
  },

  renderSearchPanel() {
    const panel = document.getElementById('search-panel');
    panel.innerHTML = `
      <div class="field" style="margin-bottom:8px;"><input type="text" id="search-input" placeholder="Search events"></div>
      <div id="search-results"></div>
    `;
    const input = panel.querySelector('#search-input');
    input.focus();
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const resultsEl = panel.querySelector('#search-results');
      resultsEl.innerHTML = '';
      if (!q) return;
      const userId = Store.getCurrentUserId();
      const { peopleIds } = Store.getActiveFilter(userId);
      const matches = Store.getEvents().filter(e =>
        e.title.toLowerCase().includes(q) && isEventVisible(e, userId, peopleIds)
      ).slice(0, 20);
      if (!matches.length) {
        resultsEl.innerHTML = '<p class="muted">No matches.</p>';
        return;
      }
      matches.forEach(ev => {
        const item = document.createElement('button');
        item.className = 'menu-item';
        const displayDate = ev.type === 'custom' ? (ev.dates || [])[0] : ev.date;
        item.innerHTML = `<span>${ev.title}</span><span class="muted">${displayDate}</span>`;
        item.addEventListener('click', () => {
          const d = parseISO(displayDate);
          Calendar.currentMonth = new Date(d.getFullYear(), d.getMonth(), 1);
          panel.classList.add('hidden');
          Calendar.render();
        });
        resultsEl.appendChild(item);
      });
    });
  },

  openMonthThemeModal() {
    const monthIndex = this.getRelevantMonthIndex();
    const monthName = (this.viewMode === 'month' ? this.currentMonth : this.currentDate).toLocaleString('default', { month: 'long' });
    const existing = Store.getMonthTheme(String(monthIndex));
    const isPlanner = this.viewMode === 'planner';
    const plannerExisting = isPlanner ? Store.getPlannerMonthTheme(String(monthIndex)) : null;

    const body = `
      <div class="modal-header"><h2>${monthName} background</h2><button class="modal-close" id="mt-close">${icon('x')}</button></div>
      <p class="muted">This replaces your default appearance every ${monthName}, on this device.</p>
      ${themeEditorHTML('mt', existing, Store.getTheme(), 'Show background behind the calendar too')}
      ${isPlanner ? `
        <div class="menu-divider" style="margin:16px 0;"></div>
        <label class="switch-row" id="pt-customize-row">
          <span>Customize planner background</span>
          <span class="switch">
            <input type="checkbox" id="pt-customize-toggle" ${plannerExisting ? 'checked' : ''}>
            <span class="switch-track"></span>
          </span>
        </label>
        <p class="muted" style="margin-top:-4px;">Off: the planner matches ${monthName}'s calendar look above.</p>
        <div id="pt-editor-wrap" class="${plannerExisting ? '' : 'hidden'}">
          ${themeEditorHTML('pt', plannerExisting, existing || Store.getTheme(), 'Show background behind the widgets too')}
        </div>
      ` : ''}
      <div class="btn-row">
        <button class="btn" id="mt-use-default">Use default appearance</button>
        <button class="btn btn-primary" id="mt-save">Save</button>
      </div>
    `;

    openModal(body, root => {
      root.querySelector('#mt-close').addEventListener('click', closeModal);
      const monthEditor = wireThemeEditor(root, 'mt', existing);
      let plannerEditor = null;

      if (isPlanner) {
        plannerEditor = wireThemeEditor(root, 'pt', plannerExisting);
        const toggle = root.querySelector('#pt-customize-toggle');
        const wrap = root.querySelector('#pt-editor-wrap');
        toggle.addEventListener('change', e => wrap.classList.toggle('hidden', !e.target.checked));
      }

      root.querySelector('#mt-use-default').addEventListener('click', () => {
        Store.setMonthTheme(String(monthIndex), null);
        if (isPlanner) Store.setPlannerMonthTheme(String(monthIndex), null);
        if (isPlanner) applyBackgroundForPlanner(Calendar.getRelevantMonthIndex());
        else applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
        closeModal();
      });

      root.querySelector('#mt-save').addEventListener('click', () => {
        Store.setMonthTheme(String(monthIndex), monthEditor.getTheme());
        if (isPlanner) {
          const customize = root.querySelector('#pt-customize-toggle').checked;
          Store.setPlannerMonthTheme(String(monthIndex), customize ? plannerEditor.getTheme() : null);
          applyBackgroundForPlanner(Calendar.getRelevantMonthIndex());
        } else {
          applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
        }
        closeModal();
      });
    });
  },

  render() {
    const userId = Store.getCurrentUserId();
    if (!userId) return;
    document.querySelector('.weekday-row').classList.toggle('hidden', this.viewMode !== 'month');
    if (this.viewMode === 'month') this.renderMonthView();
    else if (this.viewMode === 'week') this.renderWeekView();
    else if (this.viewMode === 'planner') this.renderPlannerView();
    else this.renderDayView(this.viewMode === 'day-everyone');
  },

  renderWeekView() {
    const userId = Store.getCurrentUserId();
    const { peopleIds, categories, categoryFilter } = Store.getActiveFilter(userId);
    this.updateHeaderLabel();
    applyBackgroundForMonth(this.getRelevantMonthIndex());

    const gridEl = document.getElementById('calendar-grid');
    gridEl.className = 'week-view';
    gridEl.innerHTML = '';

    let stickerHeaderEl = null;
    const weekDates = getWeekDates(this.currentDate);
    const todayStr = formatISO(new Date());
    weekDates.forEach((d, i) => {
      const ds = formatISO(d);
      const section = document.createElement('div');
      section.className = 'week-day-section' + (ds === todayStr ? ' today' : '');

      const header = document.createElement('div');
      const dateLabel = d.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' });
      if (i === 0) {
        // Sunday stays the first row -- the sticker button just rides along
        // on the same line, right-aligned, instead of adding a row above it.
        header.className = 'week-day-header week-day-header-sticker';
        header.innerHTML = `<span>${dateLabel}</span><button type="button" class="icon-btn" id="week-sticker-btn" aria-label="Sticker book">${icon('image')}</button>`;
        stickerHeaderEl = header;
      } else {
        header.className = 'week-day-header';
        header.textContent = dateLabel;
      }
      section.appendChild(header);

      const list = document.createElement('div');
      list.className = 'week-day-events';
      const dayEvents = this.getEventsForDate(ds, peopleIds, categories, categoryFilter);
      if (!dayEvents.length) {
        const empty = document.createElement('p');
        empty.className = 'muted week-day-empty';
        empty.textContent = 'No events';
        list.appendChild(empty);
      }
      dayEvents.forEach(ev => {
        const color = this.colorForEvent(ev, userId);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'week-event-row';
        row.style.borderLeftColor = color || '';
        row.innerHTML = `${ev.time ? `<span class="week-event-time">${formatTime12(ev.time)}</span>` : ''}<span class="week-event-title"${color ? ` style="color:${color};"` : ''}>${escapeHTML(ev.title)}</span>`;
        row.addEventListener('click', e => {
          e.stopPropagation();
          if (ev.isBirthday) this.openBirthdayModal(ev.ownerId, ev.birthdayId);
          else if (ev.isHoliday) this.openHolidayInfoModal(ev.title);
          else this.openEventModal(ev, ds);
        });
        list.appendChild(row);
      });
      list.addEventListener('click', () => this.openEventModal(null, ds));
      section.appendChild(list);
      gridEl.appendChild(section);
    });

    // Same sticker book/library as the planner view -- just backed by this
    // week's own storage bucket instead of a single day's.
    const weekStart = formatISO(weekDates[0]);
    const weekStickersLayer = document.createElement('div');
    weekStickersLayer.className = 'planner-stickers-layer';
    gridEl.appendChild(weekStickersLayer);
    const getWeekStickers = () => Store.getWeekStickers(userId, weekStart);
    const saveWeekStickers = list => Store.saveWeekStickers(userId, weekStart, list);
    this.renderPlacedStickers(weekStickersLayer, getWeekStickers, saveWeekStickers);

    gridEl.addEventListener('pointerdown', e => {
      if (e.target.closest('.planner-sticker')) return;
      weekStickersLayer.querySelectorAll('.planner-sticker.selected').forEach(s => {
        s.classList.remove('selected');
        s.querySelectorAll('.planner-sticker-handle').forEach(h => h.classList.add('hidden'));
      });
    });

    stickerHeaderEl.querySelector('#week-sticker-btn').addEventListener('click', () =>
      this.toggleStickerBook(stickerHeaderEl, userId, weekStickersLayer, getWeekStickers, saveWeekStickers));
  },

  renderDayView(everyone) {
    const userId = Store.getCurrentUserId();
    let peopleIds, categories, categoryFilter;
    if (everyone) {
      peopleIds = Store.getKnownPeople(userId).map(p => p.id);
      categories = [];
      categoryFilter = null;
    } else {
      const f = Store.getActiveFilter(userId);
      peopleIds = f.peopleIds;
      categories = f.categories;
      categoryFilter = f.categoryFilter;
    }
    this.updateHeaderLabel();
    applyBackgroundForMonth(this.getRelevantMonthIndex());

    const gridEl = document.getElementById('calendar-grid');
    gridEl.className = 'day-view';
    gridEl.innerHTML = '';

    const ds = formatISO(this.currentDate);
    const dayEvents = this.getEventsForDate(ds, peopleIds, categories, categoryFilter);
    const list = document.createElement('div');
    list.className = 'week-day-events day-view-events';
    if (!dayEvents.length) {
      const empty = document.createElement('p');
      empty.className = 'muted week-day-empty';
      empty.textContent = 'No events';
      list.appendChild(empty);
    }
    dayEvents.forEach(ev => {
      const color = this.colorForEvent(ev, userId);
      const participantNames = everyone
        ? (ev.participantIds || [ev.ownerId]).map(id => (Store.getPerson(id) || {}).name).filter(Boolean).join(', ')
        : null;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'week-event-row day-event-row';
      row.style.borderLeftColor = color || '';
      row.innerHTML = `
        ${ev.time ? `<span class="week-event-time">${formatTime12(ev.time)}</span>` : ''}
        <span class="week-event-title"${color ? ` style="color:${color};"` : ''}>${escapeHTML(ev.title)}</span>
        ${participantNames ? `<span class="muted day-event-owner">${escapeHTML(participantNames)}</span>` : ''}
      `;
      row.addEventListener('click', e => {
        e.stopPropagation();
        if (ev.isBirthday) this.openBirthdayModal(ev.ownerId, ev.birthdayId);
        else if (ev.isHoliday) this.openHolidayInfoModal(ev.title);
        else this.openEventModal(ev, ds);
      });
      list.appendChild(row);
    });
    list.addEventListener('click', () => this.openEventModal(null, ds));
    gridEl.appendChild(list);
  },

  renderPlannerView() {
    const userId = Store.getCurrentUserId();
    this.updateHeaderLabel();
    applyBackgroundForPlanner(this.getRelevantMonthIndex());

    const gridEl = document.getElementById('calendar-grid');
    gridEl.className = 'planner-view';
    gridEl.innerHTML = '';

    const dateStr = formatISO(this.currentDate);
    const layout = Store.getPlannerLayout(userId, dateStr);

    const headerRow = document.createElement('div');
    headerRow.className = 'planner-header-row';
    headerRow.innerHTML = `
      <button type="button" class="planner-header" id="planner-header-btn" aria-label="Jump to date">${this.currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}</button>
      <div class="planner-header-actions">
        <button type="button" class="icon-btn" id="planner-add-widget-btn" aria-label="Add widget">${icon('plus')}</button>
        <button type="button" class="icon-btn" id="planner-sticker-btn" aria-label="Sticker book">${icon('image')}</button>
      </div>
    `;
    gridEl.appendChild(headerRow);

    const widgetsEl = document.createElement('div');
    widgetsEl.className = 'planner-widgets';
    gridEl.appendChild(widgetsEl);

    // Two half-width widgets sharing a pairId render together in one row;
    // everything else gets its own row, same as before. An orphaned pairId
    // (partner deleted) just falls back to rendering solo.
    const renderedIds = new Set();
    layout.forEach(w => {
      if (renderedIds.has(w.id)) return;
      if (w.pairId) {
        const partner = layout.find(o => o.id !== w.id && o.pairId === w.pairId);
        if (partner) {
          const rowEl = document.createElement('div');
          rowEl.className = 'planner-widget-pair';
          rowEl.appendChild(this.renderPlannerWidget(w, dateStr, userId));
          rowEl.appendChild(this.renderPlannerWidget(partner, dateStr, userId));
          widgetsEl.appendChild(rowEl);
          renderedIds.add(w.id);
          renderedIds.add(partner.id);
          return;
        }
      }
      widgetsEl.appendChild(this.renderPlannerWidget(w, dateStr, userId));
      renderedIds.add(w.id);
    });

    if (layout.length > 1) {
      this.wirePlannerWidgetsDrag(widgetsEl, dateStr, userId);
    }

    const stickersLayer = document.createElement('div');
    stickersLayer.className = 'planner-stickers-layer';
    gridEl.appendChild(stickersLayer);
    const getStickers = () => Store.getPlannerDay(userId, dateStr).stickers;
    const saveStickers = list => {
      const d = Store.getPlannerDay(userId, dateStr);
      d.stickers = list;
      Store.savePlannerDay(userId, dateStr, d);
    };
    this.renderPlacedStickers(stickersLayer, getStickers, saveStickers);

    // Clicking anywhere that isn't a sticker deselects whichever one is selected
    // (its resize/rotate/delete handles are only shown while selected).
    gridEl.addEventListener('pointerdown', e => {
      if (e.target.closest('.planner-sticker')) return;
      stickersLayer.querySelectorAll('.planner-sticker.selected').forEach(s => {
        s.classList.remove('selected');
        s.querySelectorAll('.planner-sticker-handle').forEach(h => h.classList.add('hidden'));
      });
    });

    const headerActions = headerRow.querySelector('.planner-header-actions');
    headerRow.querySelector('#planner-header-btn').addEventListener('click', () => {
      const beforeStr = formatISO(this.currentDate);
      openDatePicker(beforeStr, null, picked => {
        this.plannerFlipDelta = picked >= beforeStr ? 1 : -1;
        this.currentDate = parseISO(picked);
        this.render();
      }, { single: true });
    });
    headerRow.querySelector('#planner-add-widget-btn').addEventListener('click', () => this.togglePlannerAddMenu(headerActions, dateStr, userId));
    headerRow.querySelector('#planner-sticker-btn').addEventListener('click', () => this.toggleStickerBook(headerActions, userId, stickersLayer, getStickers, saveStickers));

    if (this.plannerFlipDelta) {
      const flipClass = this.plannerFlipDelta > 0 ? 'flip-next' : 'flip-prev';
      this.plannerFlipDelta = null;
      void gridEl.offsetWidth; // force reflow so the animation reliably restarts
      gridEl.classList.add(flipClass);
      gridEl.addEventListener('animationend', () => gridEl.classList.remove(flipClass), { once: true });
    }
  },

  // Dedicated drag for planner widgets (replaces the generic makeSortable
  // there): dragging a widget's grip over the blank half beside another lone
  // half-width widget offers to pair them into one row; dropping anywhere
  // else just reorders, same as before. A widget dragged out of a pair
  // becomes solo again -- pairing only ever happens by explicit drop.
  wirePlannerWidgetsDrag(widgetsEl, dateStr, userId) {
    widgetsEl.addEventListener('pointerdown', e => {
      const handle = e.target.closest('.drag-handle');
      if (!handle || !widgetsEl.contains(handle)) return;
      const dragEl = handle.closest('.planner-widget');
      if (!dragEl || dragEl.parentElement.closest('.planner-widgets') !== widgetsEl) return;
      const dragId = dragEl.dataset.id;

      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);

      const rect = dragEl.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      const ghost = dragEl.cloneNode(true);
      ghost.classList.add('planner-widget-drag-ghost');
      ghost.style.width = `${rect.width}px`;
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      document.body.appendChild(ghost);
      dragEl.classList.add('dragging-source');

      let pairTargetEl = null;
      let reorderTarget = null; // { row, before }

      function clearHighlights() {
        widgetsEl.querySelectorAll('.pair-drop-target, .reorder-drop-before, .reorder-drop-after').forEach(el =>
          el.classList.remove('pair-drop-target', 'reorder-drop-before', 'reorder-drop-after'));
      }

      function move(ev) {
        ghost.style.left = `${ev.clientX - offsetX}px`;
        ghost.style.top = `${ev.clientY - offsetY}px`;

        clearHighlights();
        pairTargetEl = null;
        reorderTarget = null;

        const draggedIsHalf = dragEl.classList.contains('planner-width-half');
        const containerRect = widgetsEl.getBoundingClientRect();
        const rows = Array.from(widgetsEl.children);

        for (const row of rows) {
          if (row === dragEl) continue;
          const rrect = row.getBoundingClientRect();
          if (ev.clientY < rrect.top || ev.clientY > rrect.bottom) continue;

          const isSoloHalf = row.classList.contains('planner-widget') && row.classList.contains('planner-width-half');
          if (draggedIsHalf && isSoloHalf && ev.clientX > rrect.right && ev.clientX <= containerRect.right) {
            pairTargetEl = row;
            row.classList.add('pair-drop-target');
          } else {
            reorderTarget = { row, before: ev.clientY < rrect.top + rrect.height / 2 };
            row.classList.add(reorderTarget.before ? 'reorder-drop-before' : 'reorder-drop-after');
          }
          break;
        }
      }

      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        ghost.remove();
        dragEl.classList.remove('dragging-source');
        clearHighlights();

        const layout = Store.getPlannerLayout(userId, dateStr);
        const dragged = layout.find(w => w.id === dragId);
        if (!dragged) return;

        // Picking a widget up always releases it from whatever pair it was
        // in -- if it's dropped straight back into a pairing zone it'll get
        // a fresh pairId below, but the old partner becomes solo either way.
        if (dragged.pairId) {
          const oldPartner = layout.find(w => w.id !== dragged.id && w.pairId === dragged.pairId);
          if (oldPartner) oldPartner.pairId = null;
          dragged.pairId = null;
        }

        const originalIndex = layout.findIndex(w => w.id === dragged.id);
        const withoutDragged = layout.filter(w => w.id !== dragged.id);

        if (pairTargetEl) {
          const targetId = pairTargetEl.dataset.id;
          const targetIdx = withoutDragged.findIndex(w => w.id === targetId);
          if (targetIdx === -1) { withoutDragged.splice(originalIndex, 0, dragged); }
          else {
            const newPairId = uid();
            withoutDragged[targetIdx].pairId = newPairId;
            dragged.pairId = newPairId;
            withoutDragged.splice(targetIdx + 1, 0, dragged);
          }
        } else if (reorderTarget) {
          const row = reorderTarget.row;
          const targetIds = row.classList.contains('planner-widget-pair')
            ? Array.from(row.querySelectorAll('.planner-widget')).map(el => el.dataset.id)
            : [row.dataset.id];
          const anchorId = reorderTarget.before ? targetIds[0] : targetIds[targetIds.length - 1];
          const anchorIdx = withoutDragged.findIndex(w => w.id === anchorId);
          const insertAt = anchorIdx === -1 ? withoutDragged.length : (reorderTarget.before ? anchorIdx : anchorIdx + 1);
          withoutDragged.splice(insertAt, 0, dragged);
        } else {
          withoutDragged.splice(Math.min(originalIndex, withoutDragged.length), 0, dragged);
        }

        Store.savePlannerLayout(userId, dateStr, withoutDragged);
        Calendar.render();
      }

      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  },

  // getStickers/saveStickers let planner (per-day) and week view (per-week)
  // share this exact placement/drag/resize/rotate logic against their own storage.
  renderPlacedStickers(layer, getStickers, saveStickers) {
    layer.innerHTML = '';
    const stickers = getStickers() || [];

    function deselectAll() {
      layer.querySelectorAll('.planner-sticker.selected').forEach(s => {
        s.classList.remove('selected');
        s.querySelectorAll('.planner-sticker-handle').forEach(h => h.classList.add('hidden'));
      });
    }

    stickers.forEach(st => {
      const el = document.createElement('div');
      el.className = 'planner-sticker' + (st.type === 'image' ? ' planner-sticker-image' : '');
      el.dataset.id = st.id;
      el.style.left = `${st.x}%`;
      el.style.top = `${st.y}%`;
      el.style.transform = `translate(-50%, -50%) rotate(${st.rotation || 0}deg)`;
      if (st.type === 'image') {
        const img = document.createElement('img');
        img.src = st.value;
        img.alt = '';
        img.draggable = false;
        img.style.width = `${st.size || 70}px`;
        el.appendChild(img);
      } else {
        el.style.fontSize = `${st.size || 40}px`;
        el.textContent = st.value;
      }

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'planner-sticker-handle planner-sticker-resize hidden';
      resizeHandle.innerHTML = icon('resize-corner');
      el.appendChild(resizeHandle);

      const rotateHandle = document.createElement('div');
      rotateHandle.className = 'planner-sticker-handle planner-sticker-rotate hidden';
      rotateHandle.textContent = '↻';
      el.appendChild(rotateHandle);

      const deleteHandle = document.createElement('button');
      deleteHandle.type = 'button';
      deleteHandle.className = 'planner-sticker-handle planner-sticker-delete hidden';
      deleteHandle.innerHTML = icon('x');
      el.appendChild(deleteHandle);

      el.addEventListener('pointerdown', e => {
        if (e.target.closest('.planner-sticker-handle')) return;
        e.stopPropagation();
        deselectAll();
        el.classList.add('selected');
        el.querySelectorAll('.planner-sticker-handle').forEach(h => h.classList.remove('hidden'));

        const layerRect = layer.getBoundingClientRect();
        const move = ev => {
          const xPct = Math.max(0, Math.min(100, ((ev.clientX - layerRect.left) / layerRect.width) * 100));
          const yPct = Math.max(0, Math.min(100, ((ev.clientY - layerRect.top) / layerRect.height) * 100));
          el.style.left = `${xPct}%`;
          el.style.top = `${yPct}%`;
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          saveStickers((getStickers() || []).map(s => s.id === st.id
            ? { ...s, x: parseFloat(el.style.left), y: parseFloat(el.style.top) } : s));
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });

      const img = el.querySelector('img');
      resizeHandle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        const move = ev => {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
          const newSize = Math.max(16, Math.min(220, dist * 1.1));
          if (img) img.style.width = `${newSize}px`;
          else el.style.fontSize = `${newSize}px`;
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          const finalSize = img ? parseFloat(img.style.width) : parseFloat(el.style.fontSize);
          saveStickers((getStickers() || []).map(s => s.id === st.id ? { ...s, size: finalSize } : s));
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });

      rotateHandle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        const move = ev => {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
          el.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          const match = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform);
          const angle = match ? parseFloat(match[1]) : 0;
          saveStickers((getStickers() || []).map(s => s.id === st.id ? { ...s, rotation: angle } : s));
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });

      deleteHandle.addEventListener('pointerdown', e => e.stopPropagation());
      deleteHandle.addEventListener('click', e => {
        e.stopPropagation();
        saveStickers((getStickers() || []).filter(s => s.id !== st.id));
        el.remove();
      });

      layer.appendChild(el);
    });
  },

  toggleStickerBook(anchorEl, userId, layer, getStickers, saveStickers) {
    const existing = document.getElementById('sticker-book-panel');
    if (existing) { existing.remove(); return; }
    const otherMenu = document.getElementById('planner-add-menu');
    if (otherMenu) otherMenu.remove();

    const panel = document.createElement('div');
    panel.id = 'sticker-book-panel';
    panel.className = 'sticker-book-panel';

    const grid = document.createElement('div');
    grid.className = 'sticker-book-grid';
    panel.appendChild(grid);

    function renderGrid() {
      grid.innerHTML = '';
      Store.getStickerLibrary(userId).forEach(item => {
        const wrap = document.createElement('div');
        wrap.className = 'sticker-chip-wrap';

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'sticker-chip';
        if (item.type === 'image') chip.innerHTML = `<img src="${item.value}" alt="">`;
        else chip.textContent = item.value;
        chip.addEventListener('click', () => {
          if (chip.dataset.justDragged === '1') { chip.dataset.justDragged = ''; return; }
          saveStickers([...(getStickers() || []), {
            id: uid(), type: item.type, value: item.value,
            x: 40 + Math.random() * 20, y: 40 + Math.random() * 20, size: item.type === 'image' ? 70 : 40, rotation: 0,
          }]);
          Calendar.renderPlacedStickers(layer, getStickers, saveStickers);
        });

        // Drag straight off the book and drop it wherever you want it to
        // land on the page, instead of always landing near the middle.
        // A tap that never moves still falls through to the click handler above.
        chip.addEventListener('pointerdown', e => {
          const startX = e.clientX, startY = e.clientY;
          let dragging = false;
          let ghost = null;

          function onMove(ev) {
            if (!dragging) {
              if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
              dragging = true;
              chip.dataset.justDragged = '1';
              ghost = document.createElement('div');
              ghost.className = 'sticker-drag-ghost';
              if (item.type === 'image') ghost.innerHTML = `<img src="${item.value}" alt="">`;
              else ghost.textContent = item.value;
              document.body.appendChild(ghost);
            }
            ev.preventDefault();
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY}px`;
          }
          function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if (!dragging) return;
            ghost.remove();
            const layerRect = layer.getBoundingClientRect();
            const inLayer = ev.clientX >= layerRect.left && ev.clientX <= layerRect.right
              && ev.clientY >= layerRect.top && ev.clientY <= layerRect.bottom;
            if (!inLayer) return;
            saveStickers([...(getStickers() || []), {
              id: uid(), type: item.type, value: item.value,
              x: ((ev.clientX - layerRect.left) / layerRect.width) * 100,
              y: ((ev.clientY - layerRect.top) / layerRect.height) * 100,
              size: item.type === 'image' ? 70 : 40, rotation: 0,
            }]);
            Calendar.renderPlacedStickers(layer, getStickers, saveStickers);
          }
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });
        wrap.appendChild(chip);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'sticker-chip-remove';
        removeBtn.setAttribute('aria-label', 'Remove from sticker book');
        removeBtn.innerHTML = icon('x');
        removeBtn.addEventListener('click', e => {
          e.stopPropagation();
          Store.removeFromStickerLibrary(userId, item.id);
          renderGrid();
        });
        wrap.appendChild(removeBtn);

        grid.appendChild(wrap);
      });
    }
    renderGrid();

    const addRow = document.createElement('div');
    addRow.className = 'sticker-add-row';
    addRow.innerHTML = `<input type="text" id="sticker-custom-input" maxlength="4" placeholder="Add your own emoji"><button type="button" class="btn" id="sticker-custom-add">Add</button>`;
    panel.appendChild(addRow);
    addRow.querySelector('#sticker-custom-add').addEventListener('click', () => {
      const input = addRow.querySelector('#sticker-custom-input');
      const val = input.value.trim();
      if (!val) return;
      Store.addToStickerLibrary(userId, { type: 'emoji', value: val });
      input.value = '';
      renderGrid();
    });
    addRow.querySelector('#sticker-custom-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') addRow.querySelector('#sticker-custom-add').click();
    });

    const uploadRow = document.createElement('div');
    uploadRow.className = 'sticker-upload-row';
    uploadRow.innerHTML = `
      <button type="button" class="attachment-box" id="sticker-upload-btn">${icon('image')}<span class="attachment-box-label placeholder">Upload a sticker photo</span></button>
      <input type="file" id="sticker-upload-input" accept="image/*" capture="environment" class="hidden">
    `;
    panel.appendChild(uploadRow);
    const uploadInput = uploadRow.querySelector('#sticker-upload-input');
    uploadRow.querySelector('#sticker-upload-btn').addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        Store.addToStickerLibrary(userId, { type: 'image', value: reader.result });
        uploadInput.value = '';
        renderGrid();
      };
      reader.readAsDataURL(file);
    });

    anchorEl.appendChild(panel);

    function closeOnOutsideClick(e) {
      if (anchorEl.contains(e.target)) return;
      panel.remove();
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
  },

  renderPlannerWidget(w, dateStr, userId) {
    // Custom widgets can be a named drawing surface too -- they stay just as
    // blank as the built-in one (no title, chrome hidden until tapped), since
    // the whole point of "blank" is that it reads as bare paper either way.
    const isDrawing = w.type === 'drawing' || (w.type === 'custom' && w.kind === 'drawing');
    const isBlank = isDrawing;
    const wrap = document.createElement('div');
    wrap.className = `planner-widget sortable-item planner-width-${w.width || 'full'}${isBlank ? ' planner-widget-blank' : ''}`;
    wrap.dataset.id = w.id;

    const header = document.createElement('div');
    header.className = 'planner-widget-header';
    header.innerHTML = `
      <button type="button" class="drag-handle" aria-label="Reorder">${icon('grip')}</button>
      <span class="planner-widget-title">${isBlank ? '' : escapeHTML(w.type === 'custom' ? w.name : PLANNER_WIDGET_LABELS[w.type])}</span>
      ${w.type === 'habits' ? `<button type="button" class="icon-btn planner-habit-save-btn" title="Save as your default habit list" aria-label="Save as your default habit list">${icon('save')}</button>` : ''}
      ${isDrawing ? `<button type="button" class="icon-btn planner-save-template-btn" title="Save as reusable template" aria-label="Save as reusable template">${icon('save')}</button>` : ''}
      ${isDrawing ? `<button type="button" class="icon-btn planner-eraser-btn" title="Eraser" aria-label="Toggle eraser">${icon('eraser')}</button>` : ''}
      <button type="button" class="icon-btn planner-delete-btn" aria-label="Remove widget">${icon('x')}</button>
    `;
    wrap.appendChild(header);

    if (w.type === 'habits') {
      const habitSaveBtn = header.querySelector('.planner-habit-save-btn');
      habitSaveBtn.addEventListener('click', () => {
        Store.saveHabitTemplate(userId, Store.getHabitDefs(userId, w.id));
        habitSaveBtn.innerHTML = icon('check');
        setTimeout(() => { habitSaveBtn.innerHTML = icon('save'); }, 1200);
      });
    }

    const body = document.createElement('div');
    body.className = 'planner-widget-body' + (w.type === 'moodboard' ? ' planner-moodboard-body' : '');
    if (w.height) { body.style.height = `${w.height}px`; body.style.overflowY = 'auto'; }
    wrap.appendChild(body);

    if (w.type === 'events') this.renderPlannerEventsWidget(body, dateStr, userId);
    else if (w.type === 'mood') this.renderPlannerMoodWidget(body, dateStr, userId, w.id);
    else if (w.type === 'habits') this.renderPlannerHabitsWidget(body, dateStr, userId, w.id);
    else if (w.type === 'photos') this.renderPlannerPhotosWidget(body, dateStr, userId, w.id);
    else if (w.type === 'moodboard') { /* intentionally blank canvas */ }
    else if (isDrawing) this.renderPlannerDrawingWidget(body, dateStr, userId, w.id, header.querySelector('.planner-eraser-btn'), header.querySelector('.planner-save-template-btn'));
    else if (PLANNER_TEXT_TYPES.includes(w.type) || (w.type === 'custom' && w.kind === 'notes')) {
      this.renderPlannerNotesWidget(body, dateStr, userId, w.id, PLANNER_TEXT_PLACEHOLDERS[w.type] || 'Write something...');
    } else this.renderPlannerChecklistWidget(body, dateStr, userId, w.id);

    header.querySelector('.planner-delete-btn').addEventListener('click', () => {
      // If this widget was paired, its partner goes back to being solo instead
      // of being left pointing at a pairId nobody else has.
      const layout = Store.getPlannerLayout(userId, dateStr)
        .filter(x => x.id !== w.id)
        .map(x => (w.pairId && x.pairId === w.pairId) ? { ...x, pairId: null } : x);
      Store.savePlannerLayout(userId, dateStr, layout);
      Calendar.render();
    });

    // Blank (drawing) widgets keep their header invisible until tapped, so the
    // canvas reads as a bare page. A tap anywhere outside the handle/delete
    // button toggles it back off (hover reveals it for free on desktop).
    if (isBlank) {
      wrap.addEventListener('click', e => {
        if (e.target.closest('.drag-handle') || e.target.closest('.planner-delete-btn')) return;
        const canvasEl = e.target.closest('.planner-drawing-canvas');
        if (canvasEl && canvasEl.dataset.drew === '1') { canvasEl.dataset.drew = ''; return; }
        wrap.classList.toggle('controls-visible');
      });
    }

    // Bottom-right drag handle: vertical drag resizes height live, horizontal
    // drag flips half/full width (decided once, on release, since width only
    // has two valid states in this flex-wrap layout).
    const resizeHandle = document.createElement('button');
    resizeHandle.type = 'button';
    resizeHandle.className = 'planner-widget-resize-handle';
    resizeHandle.setAttribute('aria-label', 'Resize widget');
    resizeHandle.innerHTML = icon('resize-grip');
    wrap.appendChild(resizeHandle);

    resizeHandle.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startHeight = body.getBoundingClientRect().height;
      let previewWidth = w.width || 'full';

      const move = ev => {
        const dy = ev.clientY - startY;
        const dx = ev.clientX - startX;
        const newHeight = Math.max(60, startHeight + dy);
        body.style.height = `${newHeight}px`;
        body.style.overflowY = 'auto';

        // Live preview: whichever side of the threshold the drag currently
        // sits on wins, regardless of which width it started at — so you can
        // feel it snap both wider and narrower without needing a specific
        // starting state.
        let next = previewWidth;
        if (dx > 24) next = 'full';
        else if (dx < -24) next = 'half';
        if (next !== previewWidth) {
          previewWidth = next;
          wrap.className = `planner-widget sortable-item planner-width-${previewWidth}${isBlank ? ' planner-widget-blank' : ''}`;
        }
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        const finalHeight = parseFloat(body.style.height);
        // A full-width widget can't share a row, so flipping to full releases
        // its old partner back to solo too -- that changes a sibling's DOM,
        // which needs a real re-render rather than just this widget's class swap.
        const unpairing = !!w.pairId && previewWidth === 'full';
        let layout = Store.getPlannerLayout(userId, dateStr).map(x => x.id === w.id
          ? { ...x, width: previewWidth, height: finalHeight, pairId: unpairing ? null : x.pairId } : x);
        if (unpairing) layout = layout.map(x => x.pairId === w.pairId ? { ...x, pairId: null } : x);
        Store.savePlannerLayout(userId, dateStr, layout);
        w.width = previewWidth;
        w.height = finalHeight;
        if (unpairing) Calendar.render();
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });

    return wrap;
  },

  renderPlannerEventsWidget(body, dateStr, userId) {
    const { peopleIds, categories, categoryFilter } = Store.getActiveFilter(userId);
    const events = this.getEventsForDate(dateStr, peopleIds, categories, categoryFilter);
    if (!events.length) {
      body.innerHTML = '<p class="muted planner-empty">No events today.</p>';
      return;
    }
    events.forEach(ev => {
      const color = this.colorForEvent(ev, userId);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'week-event-row';
      row.style.borderLeftColor = color || '';
      row.innerHTML = `${ev.time ? `<span class="week-event-time">${formatTime12(ev.time)}</span>` : ''}<span class="week-event-title"${color ? ` style="color:${color};"` : ''}>${escapeHTML(ev.title)}</span>`;
      row.addEventListener('click', () => {
        if (ev.isBirthday) this.openBirthdayModal(ev.ownerId, ev.birthdayId);
        else if (ev.isHoliday) this.openHolidayInfoModal(ev.title);
        else this.openEventModal(ev, dateStr);
      });
      body.appendChild(row);
    });
  },

  renderPlannerNotesWidget(body, dateStr, userId, widgetId, placeholder) {
    const dayData = Store.getPlannerDay(userId, dateStr);
    const textarea = document.createElement('textarea');
    textarea.className = 'planner-notes-textarea';
    textarea.placeholder = placeholder || 'Write something...';
    textarea.value = (dayData.content && dayData.content[widgetId]) || '';
    textarea.addEventListener('change', () => {
      const d = Store.getPlannerDay(userId, dateStr);
      d.content = d.content || {};
      d.content[widgetId] = textarea.value;
      Store.savePlannerDay(userId, dateStr, d);
    });
    body.appendChild(textarea);
  },

  renderPlannerChecklistWidget(body, dateStr, userId, widgetId) {
    const list = document.createElement('div');
    list.className = 'planner-checklist';
    body.appendChild(list);

    function refresh() {
      const dayData = Store.getPlannerDay(userId, dateStr);
      const items = (dayData.content && dayData.content[widgetId]) || [];
      list.innerHTML = '';
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'planner-checklist-row';
        row.innerHTML = `
          <input type="checkbox" ${item.checked ? 'checked' : ''}>
          <input type="text" class="planner-checklist-text-input${item.checked ? ' checked' : ''}" value="${escapeAttr(item.text)}">
        `;
        row.querySelector('input[type="checkbox"]').addEventListener('change', e => {
          const d = Store.getPlannerDay(userId, dateStr);
          d.content = d.content || {};
          d.content[widgetId] = (d.content[widgetId] || []).map(it => it.id === item.id ? { ...it, checked: e.target.checked } : it);
          Store.savePlannerDay(userId, dateStr, d);
          refresh();
        });
        const textInput = row.querySelector('.planner-checklist-text-input');
        function commitEdit() {
          const text = textInput.value.trim();
          const d = Store.getPlannerDay(userId, dateStr);
          d.content = d.content || {};
          d.content[widgetId] = text
            ? (d.content[widgetId] || []).map(it => it.id === item.id ? { ...it, text } : it)
            : (d.content[widgetId] || []).filter(it => it.id !== item.id);
          Store.savePlannerDay(userId, dateStr, d);
          refresh();
        }
        textInput.addEventListener('blur', commitEdit);
        textInput.addEventListener('keydown', e => { if (e.key === 'Enter') textInput.blur(); });
        list.appendChild(row);
      });
    }
    refresh();

    const addRow = document.createElement('div');
    addRow.className = 'planner-checklist-row planner-add-item-row';
    addRow.innerHTML = `
      <input type="checkbox" disabled>
      <input type="text" class="planner-add-item-input" placeholder="Add item">
    `;
    body.appendChild(addRow);
    const input = addRow.querySelector('.planner-add-item-input');
    function commit() {
      const text = input.value.trim();
      if (!text) return;
      const d = Store.getPlannerDay(userId, dateStr);
      d.content = d.content || {};
      d.content[widgetId] = [...(d.content[widgetId] || []), { id: uid(), text, checked: false }];
      Store.savePlannerDay(userId, dateStr, d);
      input.value = '';
      refresh();
      input.focus();
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
  },

  renderPlannerMoodWidget(body, dateStr, userId, widgetId) {
    const row = document.createElement('div');
    row.className = 'planner-mood-row';
    body.appendChild(row);

    function refresh() {
      const dayData = Store.getPlannerDay(userId, dateStr);
      const current = dayData.content && dayData.content[widgetId];
      row.innerHTML = '';
      PLANNER_MOOD_OPTIONS.forEach(moodKey => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'planner-mood-btn' + (current === moodKey ? ' selected' : '');
        btn.setAttribute('aria-label', moodKey.replace('mood-', '').replace('-', ' '));
        btn.innerHTML = icon(moodKey);
        btn.addEventListener('click', () => {
          const d = Store.getPlannerDay(userId, dateStr);
          d.content = d.content || {};
          d.content[widgetId] = d.content[widgetId] === moodKey ? null : moodKey;
          Store.savePlannerDay(userId, dateStr, d);
          refresh();
        });
        row.appendChild(btn);
      });
    }
    refresh();
  },

  renderPlannerHabitsWidget(body, dateStr, userId, widgetId) {
    const list = document.createElement('div');
    list.className = 'planner-checklist';
    body.appendChild(list);

    function refresh() {
      const habits = Store.getHabitDefs(userId, widgetId);
      const dayData = Store.getPlannerDay(userId, dateStr);
      const checked = (dayData.content && dayData.content[widgetId]) || {};
      list.innerHTML = '';
      habits.forEach(habit => {
        const row = document.createElement('div');
        row.className = 'planner-checklist-row';
        row.innerHTML = `
          <input type="checkbox" ${checked[habit.id] ? 'checked' : ''}>
          <input type="text" class="planner-checklist-text-input${checked[habit.id] ? ' checked' : ''}" value="${escapeAttr(habit.text)}">
        `;
        row.querySelector('input[type="checkbox"]').addEventListener('change', e => {
          const d = Store.getPlannerDay(userId, dateStr);
          d.content = d.content || {};
          d.content[widgetId] = { ...(d.content[widgetId] || {}), [habit.id]: e.target.checked };
          Store.savePlannerDay(userId, dateStr, d);
          refresh();
        });
        const textInput = row.querySelector('.planner-checklist-text-input');
        function commitEdit() {
          const text = textInput.value.trim();
          if (text) Store.saveHabitDefs(userId, widgetId, Store.getHabitDefs(userId, widgetId).map(h => h.id === habit.id ? { ...h, text } : h));
          else Store.saveHabitDefs(userId, widgetId, Store.getHabitDefs(userId, widgetId).filter(h => h.id !== habit.id));
          refresh();
        }
        textInput.addEventListener('blur', commitEdit);
        textInput.addEventListener('keydown', e => { if (e.key === 'Enter') textInput.blur(); });
        list.appendChild(row);
      });
    }
    refresh();

    const addRow = document.createElement('div');
    addRow.className = 'planner-checklist-row planner-add-item-row';
    addRow.innerHTML = `
      <input type="checkbox" disabled>
      <input type="text" class="planner-add-item-input" placeholder="Add habit">
    `;
    body.appendChild(addRow);
    const input = addRow.querySelector('.planner-add-item-input');
    function commit() {
      const text = input.value.trim();
      if (!text) return;
      Store.saveHabitDefs(userId, widgetId, [...Store.getHabitDefs(userId, widgetId), { id: uid(), text }]);
      input.value = '';
      refresh();
      input.focus();
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
  },

  renderPlannerPhotosWidget(body, dateStr, userId, widgetId) {
    const grid = document.createElement('div');
    grid.className = 'planner-photo-grid';
    body.appendChild(grid);

    function refresh() {
      const dayData = Store.getPlannerDay(userId, dateStr);
      const photos = (dayData.content && dayData.content[widgetId]) || [];
      grid.innerHTML = '';
      photos.forEach(photo => {
        const cell = document.createElement('div');
        cell.className = 'planner-photo-cell';
        cell.innerHTML = `
          <img src="${photo.dataUrl}" alt="">
          <button type="button" class="icon-btn planner-photo-remove" aria-label="Remove photo">${icon('x')}</button>
        `;
        cell.querySelector('.planner-photo-remove').addEventListener('click', () => {
          const d = Store.getPlannerDay(userId, dateStr);
          d.content = d.content || {};
          d.content[widgetId] = (d.content[widgetId] || []).filter(p => p.id !== photo.id);
          Store.savePlannerDay(userId, dateStr, d);
          refresh();
        });
        grid.appendChild(cell);
      });

      const uploadCell = document.createElement('button');
      uploadCell.type = 'button';
      uploadCell.className = 'planner-photo-upload';
      uploadCell.setAttribute('aria-label', 'Add photo');
      uploadCell.innerHTML = icon('plus');
      uploadCell.addEventListener('click', () => fileInput.click());
      grid.appendChild(uploadCell);
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const d = Store.getPlannerDay(userId, dateStr);
        d.content = d.content || {};
        d.content[widgetId] = [...(d.content[widgetId] || []), { id: uid(), dataUrl: reader.result }];
        Store.savePlannerDay(userId, dateStr, d);
        fileInput.value = '';
        refresh();
      };
      reader.readAsDataURL(file);
    });
    body.appendChild(fileInput);

    refresh();
  },

  // A bare drawing surface, sized for Apple Pencil. Strokes are stored as
  // normalized (0-1) point lists so they replay correctly at any widget size,
  // and only pen/mouse pointers draw — touch is left alone so a finger still
  // scrolls the page (and a finger tap toggles the widget's hidden controls).
  renderPlannerDrawingWidget(body, dateStr, userId, widgetId, eraserBtn, saveTemplateBtn) {
    body.classList.add('planner-drawing-body');
    const canvas = document.createElement('canvas');
    canvas.className = 'planner-drawing-canvas';
    body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    const dayData = Store.getPlannerDay(userId, dateStr);
    // Each stroke is {tool: 'pen'|'eraser', points: [{x,y,p}, ...]}. Plain
    // arrays can't carry an extra .tool property through JSON.stringify, so
    // strokes are wrapped in an object instead -- otherwise the eraser tag
    // would silently vanish the moment it's saved and reloaded.
    let strokes = ((dayData.content && dayData.content[widgetId]) || []).map(s =>
      Array.isArray(s) ? { tool: 'pen', points: s } : s);
    let currentStroke = null;
    let lastPoint = null;
    let tool = 'pen'; // 'pen' | 'eraser'

    function inkColor() { return getComputedStyle(canvas).color; }

    // Eraser strokes are replayed with destination-out so they cut through
    // everything drawn before them, in the original chronological order --
    // real pixel erasing, not just deleting whole strokes you brush past.
    function withTool(strokeTool, fn) {
      if (strokeTool === 'eraser') {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        fn();
        ctx.restore();
      } else {
        fn();
      }
    }

    function redraw() {
      const rect = body.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const color = inkColor();
      strokes.forEach(stroke => drawStroke(stroke, rect, color));
    }

    function drawStroke(stroke, rect, color) {
      const strokeTool = stroke.tool || 'pen';
      const points = stroke.points;
      withTool(strokeTool, () => {
        if (points.length === 1) {
          const p = points[0];
          const radius = strokeTool === 'eraser' ? 14 : Math.max(1, p.p * 2);
          ctx.beginPath();
          ctx.fillStyle = strokeTool === 'eraser' ? '#000' : color;
          ctx.arc(p.x * rect.width, p.y * rect.height, radius, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        for (let i = 1; i < points.length; i++) {
          drawSegment(points[i - 1], points[i], rect, color, strokeTool);
        }
      });
    }

    function drawSegment(a, b, rect, color, strokeTool) {
      ctx.beginPath();
      ctx.strokeStyle = strokeTool === 'eraser' ? '#000' : color;
      ctx.lineWidth = strokeTool === 'eraser' ? 28 : Math.max(1, ((a.p + b.p) / 2) * 4);
      ctx.moveTo(a.x * rect.width, a.y * rect.height);
      ctx.lineTo(b.x * rect.width, b.y * rect.height);
      ctx.stroke();
    }

    function resizeCanvas() {
      const rect = body.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    new ResizeObserver(resizeCanvas).observe(body);

    function pointFromEvent(e) {
      const rect = body.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        p: e.pressure > 0 ? e.pressure : 0.5,
      };
    }

    function persist() {
      const d = Store.getPlannerDay(userId, dateStr);
      d.content = d.content || {};
      d.content[widgetId] = strokes;
      Store.savePlannerDay(userId, dateStr, d);
    }

    if (eraserBtn) {
      eraserBtn.addEventListener('click', () => {
        tool = tool === 'pen' ? 'eraser' : 'pen';
        eraserBtn.classList.toggle('active', tool === 'eraser');
        canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
      });
    }

    if (saveTemplateBtn) {
      saveTemplateBtn.addEventListener('click', () => {
        Calendar.openSaveDrawingTemplateModal(userId, name => {
          const templates = Store.getDrawingTemplates(userId);
          templates.push({ id: uid(), name, strokes: JSON.parse(JSON.stringify(strokes)) });
          Store.saveDrawingTemplates(userId, templates);
          saveTemplateBtn.innerHTML = icon('check');
          setTimeout(() => { saveTemplateBtn.innerHTML = icon('save'); }, 1200);
        });
      });
    }

    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return; // fingers scroll / reveal controls; pen (or mouse) draws
      e.preventDefault();
      canvas.dataset.drew = '1'; // suppresses the tap-to-reveal click that follows a draw
      canvas.setPointerCapture(e.pointerId);
      const p = pointFromEvent(e);
      currentStroke = { tool, points: [p] };
      lastPoint = p;
    });
    canvas.addEventListener('pointermove', e => {
      if (!currentStroke) return;
      e.preventDefault();
      const rect = body.getBoundingClientRect();
      const p = pointFromEvent(e);
      withTool(currentStroke.tool, () => drawSegment(lastPoint, p, rect, inkColor(), currentStroke.tool));
      currentStroke.points.push(p);
      lastPoint = p;
    });
    function endStroke() {
      if (!currentStroke) return;
      if (currentStroke.points.length === 1) drawStroke(currentStroke, body.getBoundingClientRect(), inkColor());
      strokes = [...strokes, currentStroke];
      currentStroke = null;
      lastPoint = null;
      persist();
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
  },

  openSaveDrawingTemplateModal(userId, onSave) {
    openModal(`
      <div class="modal-header"><h2>Save as template</h2><button class="modal-close" id="sdt-close">${icon('x')}</button></div>
      <div class="field"><input type="text" id="sdt-name" placeholder="Template name"></div>
      <div class="btn-row"><button class="btn btn-primary" id="sdt-save">Save</button></div>
    `, root => {
      root.querySelector('#sdt-close').addEventListener('click', closeModal);
      const nameInput = root.querySelector('#sdt-name');
      function commit() {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        onSave(name);
        closeModal();
      }
      root.querySelector('#sdt-save').addEventListener('click', commit);
      nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
      nameInput.focus();
    });
  },

  togglePlannerAddMenu(anchorEl, dateStr, userId) {
    const existing = document.getElementById('planner-add-menu');
    if (existing) { existing.remove(); return; }
    const otherPanel = document.getElementById('sticker-book-panel');
    if (otherPanel) otherPanel.remove();
    const otherPresets = document.getElementById('planner-presets-panel');
    if (otherPresets) otherPresets.remove();

    const menu = document.createElement('div');
    menu.id = 'planner-add-menu';
    menu.className = 'planner-add-menu';

    const presetsRow = document.createElement('div');
    presetsRow.className = 'menu-item-row';
    const presetsBtn = document.createElement('button');
    presetsBtn.type = 'button';
    presetsBtn.className = 'menu-item';
    presetsBtn.textContent = 'Presets';
    presetsBtn.addEventListener('click', () => {
      menu.remove();
      this.togglePlannerPresetsPanel(anchorEl, dateStr, userId);
    });
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'icon-btn';
    saveBtn.title = 'Save current layout as a preset';
    saveBtn.setAttribute('aria-label', 'Save current layout as a preset');
    saveBtn.innerHTML = icon('save');
    saveBtn.querySelector('svg').style.cssText = 'width:14px;height:14px;';
    presetsRow.appendChild(presetsBtn);
    presetsRow.appendChild(saveBtn);
    menu.appendChild(presetsRow);

    const saveRow = document.createElement('div');
    saveRow.className = 'hidden planner-preset-save-row';
    saveRow.innerHTML = `
      <input type="text" placeholder="Preset name" class="planner-preset-name-input">
      <button type="button" class="btn">Save</button>
    `;
    menu.appendChild(saveRow);
    saveBtn.addEventListener('click', () => {
      saveRow.classList.toggle('hidden');
      if (!saveRow.classList.contains('hidden')) saveRow.querySelector('input').focus();
    });
    function commitSavePreset() {
      const nameInput = saveRow.querySelector('input');
      const name = nameInput.value.trim();
      if (!name) return;
      Store.addPlannerPreset(userId, name, Store.getPlannerLayout(userId, dateStr));
      nameInput.value = '';
      saveRow.classList.add('hidden');
    }
    saveRow.querySelector('.btn').addEventListener('click', commitSavePreset);
    saveRow.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') commitSavePreset(); });

    const div = document.createElement('div');
    div.className = 'menu-divider';
    menu.appendChild(div);

    const catalogList = document.createElement('div');
    catalogList.className = 'planner-catalog-list';
    menu.appendChild(catalogList);

    function renderCatalogList() {
      catalogList.innerHTML = '';
      Store.getPlannerWidgetCatalog(userId).forEach(type => {
        if (!PLANNER_WIDGET_LABELS[type]) return;
        const row = document.createElement('div');
        row.className = 'menu-item-row planner-catalog-row sortable-item';
        row.dataset.id = type;
        row.innerHTML = `
          <button type="button" class="drag-handle" aria-label="Reorder">${icon('grip')}</button>
          <button type="button" class="menu-item">${PLANNER_WIDGET_LABELS[type]}</button>
          <button type="button" class="icon-btn" aria-label="Remove ${PLANNER_WIDGET_LABELS[type]} from menu">${icon('x')}</button>
        `;
        row.querySelector('.menu-item').addEventListener('click', () => {
          const newId = uid();
          const layout = Store.getPlannerLayout(userId, dateStr);
          layout.push({ id: newId, type, width: 'full' });
          Store.savePlannerLayout(userId, dateStr, layout);
          if (type === 'habits') {
            const template = Store.getHabitTemplate(userId).map(h => ({ id: uid(), text: h.text }));
            Store.saveHabitDefs(userId, newId, template);
          }
          Calendar.render();
        });
        row.querySelector('.icon-btn').addEventListener('click', e => {
          e.stopPropagation();
          Store.savePlannerWidgetCatalog(userId, Store.getPlannerWidgetCatalog(userId).filter(t => t !== type));
          renderCatalogList();
        });
        catalogList.appendChild(row);
      });
    }
    renderCatalogList();

    makeSortable(catalogList, orderedKeys => {
      Store.savePlannerWidgetCatalog(userId, orderedKeys);
    });

    // Drawing templates you've saved from a drawing widget's "save as
    // template" button -- pick one here to start a new drawing widget
    // pre-seeded with those same strokes instead of a blank canvas.
    const drawingTemplates = Store.getDrawingTemplates(userId);
    if (drawingTemplates.length) {
      const divT = document.createElement('div');
      divT.className = 'menu-divider';
      menu.appendChild(divT);

      const templatesLabel = document.createElement('div');
      templatesLabel.className = 'menu-section-label';
      templatesLabel.textContent = 'Drawing templates';
      menu.appendChild(templatesLabel);

      drawingTemplates.forEach(tpl => {
        const row = document.createElement('div');
        row.className = 'menu-item-row';
        row.innerHTML = `
          <button type="button" class="menu-item">${escapeHTML(tpl.name)}</button>
          <button type="button" class="icon-btn" aria-label="Delete ${escapeHTML(tpl.name)} template">${icon('x')}</button>
        `;
        row.querySelector('.menu-item').addEventListener('click', () => {
          const layout = Store.getPlannerLayout(userId, dateStr);
          const newId = uid();
          layout.push({ id: newId, type: 'drawing', width: 'full' });
          Store.savePlannerLayout(userId, dateStr, layout);
          const d = Store.getPlannerDay(userId, dateStr);
          d.content = d.content || {};
          d.content[newId] = JSON.parse(JSON.stringify(tpl.strokes));
          Store.savePlannerDay(userId, dateStr, d);
          Calendar.render();
        });
        row.querySelector('.icon-btn').addEventListener('click', e => {
          e.stopPropagation();
          Store.saveDrawingTemplates(userId, Store.getDrawingTemplates(userId).filter(t => t.id !== tpl.id));
          row.remove();
        });
        menu.appendChild(row);
      });
    }

    const div2 = document.createElement('div');
    div2.className = 'menu-divider';
    menu.appendChild(div2);

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'menu-item';
    customBtn.textContent = '+ Custom Widget...';
    menu.appendChild(customBtn);

    const customForm = document.createElement('div');
    customForm.className = 'hidden planner-custom-widget-form';
    customForm.innerHTML = `
      <input type="text" placeholder="Widget name" class="planner-preset-name-input">
      <div class="planner-custom-kind-row">
        <button type="button" class="btn" data-kind="checklist">Checklist</button>
        <button type="button" class="btn" data-kind="notes">Notes</button>
        <button type="button" class="btn" data-kind="drawing">Drawing</button>
      </div>
    `;
    menu.appendChild(customForm);
    customBtn.addEventListener('click', () => {
      customForm.classList.toggle('hidden');
      if (!customForm.classList.contains('hidden')) customForm.querySelector('input').focus();
    });
    customForm.querySelectorAll('[data-kind]').forEach(kindBtn => {
      kindBtn.addEventListener('click', () => {
        const nameInput = customForm.querySelector('input');
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const layout = Store.getPlannerLayout(userId, dateStr);
        layout.push({ id: uid(), type: 'custom', name, kind: kindBtn.dataset.kind, width: 'full' });
        Store.savePlannerLayout(userId, dateStr, layout);
        Calendar.render();
      });
    });

    anchorEl.appendChild(menu);

    function closeOnOutsideClick(e) {
      if (anchorEl.contains(e.target)) return;
      menu.remove();
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
  },

  togglePlannerPresetsPanel(anchorEl, dateStr, userId) {
    const existing = document.getElementById('planner-presets-panel');
    if (existing) { existing.remove(); return; }
    const otherMenu = document.getElementById('planner-add-menu');
    if (otherMenu) otherMenu.remove();
    const otherSticker = document.getElementById('sticker-book-panel');
    if (otherSticker) otherSticker.remove();

    const panel = document.createElement('div');
    panel.id = 'planner-presets-panel';
    panel.className = 'planner-add-menu';

    function renderList() {
      panel.innerHTML = '';
      const presets = Store.getPlannerPresets(userId);
      if (!presets.length) {
        panel.innerHTML = '<p class="muted" style="padding:6px 10px;">No saved presets yet.</p>';
        return;
      }
      presets.forEach(preset => {
        const row = document.createElement('div');
        row.className = 'menu-item-row';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-item';
        btn.textContent = preset.name;
        btn.addEventListener('click', () => {
          const newLayout = preset.layout.map(w => ({ ...w, id: uid() }));
          Store.savePlannerLayout(userId, dateStr, newLayout);
          const template = Store.getHabitTemplate(userId);
          newLayout.filter(w => w.type === 'habits').forEach(w => {
            Store.saveHabitDefs(userId, w.id, template.map(h => ({ id: uid(), text: h.text })));
          });
          panel.remove();
          Calendar.render();
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'icon-btn';
        delBtn.setAttribute('aria-label', `Delete preset ${preset.name}`);
        delBtn.innerHTML = icon('x');
        delBtn.querySelector('svg').style.cssText = 'width:14px;height:14px;';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          Store.deletePlannerPreset(userId, preset.id);
          renderList();
        });

        row.appendChild(btn);
        row.appendChild(delBtn);
        panel.appendChild(row);
      });
    }
    renderList();

    anchorEl.appendChild(panel);

    function closeOnOutsideClick(e) {
      if (anchorEl.contains(e.target)) return;
      panel.remove();
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
  },

  renderMonthView() {
    const userId = Store.getCurrentUserId();
    const { peopleIds, categories, categoryFilter } = Store.getActiveFilter(userId);

    const year = this.currentMonth.getFullYear();
    const month = this.currentMonth.getMonth();
    document.getElementById('month-label').textContent =
      this.currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    applyBackgroundForMonth(month);

    const gridDates = getGridDates(year, month);
    const gridStart = formatISO(gridDates[0]);
    const gridEnd = formatISO(gridDates[gridDates.length - 1]);

    const dateMap = {};
    const multiDayEvents = [];
    Store.getEvents().forEach(event => {
      if (!isEventVisible(event, userId, peopleIds)) return;
      if (categories && categories.length && !categories.includes(event.category)) return;
      if (categoryFilter && event.category !== categoryFilter) return;
      if (event.type === 'single' && event.endDate && event.endDate > event.date) {
        multiDayEvents.push(event);
        return;
      }
      expandOccurrences(event, gridStart, gridEnd).forEach(ds => {
        (dateMap[ds] = dateMap[ds] || []).push(event);
      });
    });
    gridDates.forEach(d => {
      const ds = formatISO(d);
      this.getBirthdayOccurrences(ds, peopleIds).forEach(b => {
        (dateMap[ds] = dateMap[ds] || []).push(b);
      });
      this.getHolidayOccurrences(ds, userId).forEach(h => {
        (dateMap[ds] = dateMap[ds] || []).push(h);
      });
    });

    const todayStr = formatISO(new Date());
    const gridEl = document.getElementById('calendar-grid');
    gridEl.className = 'calendar-grid';
    gridEl.innerHTML = '';

    const BAR_SLOT = 16;
    const NUMBER_BAND = 17;
    const barCoverageByDate = {};
    gridDates.forEach(d => {
      const ds = formatISO(d);
      barCoverageByDate[ds] = multiDayEvents.filter(ev => ev.date <= ds && ev.endDate >= ds).length;
    });

    const dayCellEls = [];
    gridDates.forEach(d => {
      const ds = formatISO(d);
      const cell = document.createElement('div');
      cell.className = 'day-cell' + (d.getMonth() !== month ? ' outside' : '') + (ds === todayStr ? ' today' : '');

      const num = document.createElement('div');
      num.className = 'day-num';
      num.textContent = d.getDate();
      cell.appendChild(num);

      if (barCoverageByDate[ds] > 0) {
        const spacer = document.createElement('div');
        spacer.className = 'day-cell-barspacer';
        spacer.style.height = (barCoverageByDate[ds] * BAR_SLOT) + 'px';
        cell.appendChild(spacer);
      }

      const dayEvents = (dateMap[ds] || []).slice().sort(compareEventOrder);
      dayEvents.slice(0, 3).forEach(ev => {
        const chip = document.createElement('div');
        chip.className = 'event-chip';
        chip.textContent = ev.title;
        const color = this.colorForEvent(ev, userId);
        if (color) {
          chip.style.background = color + '22';
          chip.style.color = color;
        }
        chip.addEventListener('click', e => {
          e.stopPropagation();
          if (ev.isBirthday) this.openBirthdayModal(ev.ownerId, ev.birthdayId);
          else if (ev.isHoliday) this.openHolidayInfoModal(ev.title);
          else this.openEventModal(ev, ds);
        });
        cell.appendChild(chip);
      });
      if (dayEvents.length > 3) {
        const more = document.createElement('div');
        more.className = 'event-more';
        more.textContent = `+${dayEvents.length - 3} more`;
        cell.appendChild(more);
      }

      const hasAnyEvents = dayEvents.length > 0 || multiDayEvents.some(ev => ev.date <= ds && ev.endDate >= ds);
      cell.addEventListener('click', () => {
        if (hasAnyEvents) this.openDayView(ds);
        else this.openEventModal(null, ds);
      });
      gridEl.appendChild(cell);
      dayCellEls.push(cell);
    });

    // Render multi-day events as bars spanning their day columns, one week-row at a time.
    const gridRect = gridEl.getBoundingClientRect();
    for (let w = 0; w < gridDates.length; w += 7) {
      const weekDates = gridDates.slice(w, w + 7);
      const weekStart = formatISO(weekDates[0]);
      const weekEnd = formatISO(weekDates[6]);
      const overlapping = multiDayEvents.filter(ev => ev.date <= weekEnd && ev.endDate >= weekStart);
      overlapping.forEach((ev, stackIdx) => {
        const segStart = ev.date > weekStart ? ev.date : weekStart;
        const segEnd = ev.endDate < weekEnd ? ev.endDate : weekEnd;
        const colStart = weekDates.findIndex(d => formatISO(d) === segStart);
        const colEnd = weekDates.findIndex(d => formatISO(d) === segEnd);
        if (colStart === -1 || colEnd === -1) return;
        const rectStart = dayCellEls[w + colStart].getBoundingClientRect();
        const rectEnd = dayCellEls[w + colEnd].getBoundingClientRect();

        const bar = document.createElement('div');
        bar.className = 'multiday-bar';
        bar.textContent = ev.title;
        const color = this.colorForEvent(ev, userId);
        if (color) {
          bar.style.background = color + '33';
          bar.style.color = color;
        }
        bar.style.left = (rectStart.left - gridRect.left) + 'px';
        bar.style.width = (rectEnd.right - rectStart.left) + 'px';
        bar.style.top = (rectStart.top - gridRect.top + NUMBER_BAND + stackIdx * BAR_SLOT) + 'px';
        bar.style.borderTopLeftRadius = segStart === ev.date ? '6px' : '0';
        bar.style.borderBottomLeftRadius = segStart === ev.date ? '6px' : '0';
        bar.style.borderTopRightRadius = segEnd === ev.endDate ? '6px' : '0';
        bar.style.borderBottomRightRadius = segEnd === ev.endDate ? '6px' : '0';
        bar.addEventListener('click', e => {
          e.stopPropagation();
          this.openEventModal(ev, ev.date);
        });
        gridEl.appendChild(bar);
      });
    }
  },

  openDayView(dateStr) {
    const userId = Store.getCurrentUserId();
    const { peopleIds, categories, categoryFilter } = Store.getActiveFilter(userId);

    const dayEvents = this.getEventsForDate(dateStr, peopleIds, categories, categoryFilter);

    const dateLabel = parseISO(dateStr).toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });

    const body = `
      <div class="modal-header"><h2>${dateLabel}</h2><button class="modal-close" id="dv-close">${icon('x')}</button></div>
      <div id="dv-list"></div>
      <button type="button" class="btn btn-primary" id="dv-add" style="width:100%;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;">${icon('plus')}<span>Add event</span></button>
    `;

    openModal(body, root => {
      root.querySelector('#dv-close').addEventListener('click', closeModal);
      const listEl = root.querySelector('#dv-list');
      if (!dayEvents.length) {
        listEl.innerHTML = '<p class="muted">No events yet.</p>';
      }
      dayEvents.forEach(ev => {
        const color = this.colorForEvent(ev, userId);
        const row = document.createElement('div');
        row.className = 'day-view-row sortable-item';
        row.dataset.id = ev.id;
        row.style.borderLeftColor = color || '';
        row.innerHTML = `
          ${(ev.isBirthday || ev.isHoliday) ? '' : `<button type="button" class="drag-handle" aria-label="Reorder event">${icon('grip')}</button>`}
          <button type="button" class="day-view-row-open">
            <span${color ? ` style="color:${color};"` : ''}>${escapeHTML(ev.title)}</span>${ev.time ? `<span class="muted" style="margin-left:auto;">${formatTime12(ev.time)}</span>` : ''}
          </button>
        `;
        row.querySelector('.day-view-row-open').addEventListener('click', () => {
          closeModal();
          if (ev.isBirthday) this.openBirthdayModal(ev.ownerId, ev.birthdayId);
          else if (ev.isHoliday) this.openHolidayInfoModal(ev.title);
          else this.openEventModal(ev, dateStr);
        });
        listEl.appendChild(row);
      });
      if (dayEvents.length > 1) {
        makeSortable(listEl, orderedIds => {
          orderedIds.forEach((id, i) => Store.updateEvent(id, { order: i }));
          Calendar.render();
        });
      }
      root.querySelector('#dv-add').addEventListener('click', () => {
        closeModal();
        this.openEventModal(null, dateStr);
      });
    });
  },

  // Settings entry point: list your own birthdays, with inline add/edit
  // (mirroring openManageCategoriesModal's list+inline-edit pattern) and delete.
  openBirthdaysManager() {
    const userId = Store.getCurrentUserId();

    const body = `
      <div class="modal-header"><h2>Birthdays</h2><button class="modal-close" id="bd-close">${icon('x')}</button></div>
      <p class="muted">Visible to your connections on the calendar.</p>
      <div id="bd-list"></div>
      <div id="bd-form-wrap"></div>
      <button type="button" class="btn" id="bd-add-btn" style="width:100%;margin-top:8px;">+ Add birthday</button>
    `;
    openModal(body, root => {
      root.querySelector('#bd-close').addEventListener('click', closeModal);
      const listEl = root.querySelector('#bd-list');
      const formWrap = root.querySelector('#bd-form-wrap');
      const addBtn = root.querySelector('#bd-add-btn');

      function closeForm() {
        formWrap.innerHTML = '';
        addBtn.classList.remove('hidden');
      }

      function renderForm(existing) {
        addBtn.classList.add('hidden');
        formWrap.innerHTML = `
          <div class="field"><input type="text" id="bd-name" placeholder="Name" value="${existing ? escapeAttr(existing.name) : ''}"></div>
          <div class="field-row">
            <select id="bd-month">${MONTH_OPTIONS}</select>
            <select id="bd-day">${DAY_OPTIONS}</select>
            <input type="number" id="bd-year" placeholder="Year (optional)">
          </div>
          <div class="field-row" style="align-items:center;">
            <input type="color" id="bd-color" class="color-box" value="${(existing && existing.color) || HOLIDAY_COLOR}">
            <button type="button" class="link-btn" id="bd-color-clear">Use their usual color</button>
          </div>
          <div class="btn-row">
            ${existing ? `<button class="btn btn-danger" id="bd-delete">Delete</button>` : ''}
            <button class="btn" id="bd-cancel">Cancel</button>
            <button class="btn btn-primary" id="bd-save">Save</button>
          </div>
        `;
        formWrap.querySelector('#bd-month').value = existing ? existing.month : new Date().getMonth() + 1;
        formWrap.querySelector('#bd-day').value = existing ? existing.day : new Date().getDate();
        if (existing && existing.year) formWrap.querySelector('#bd-year').value = existing.year;
        let chosenColor = existing ? existing.color || null : null;
        const colorInput = formWrap.querySelector('#bd-color');
        colorInput.addEventListener('input', e => { chosenColor = e.target.value; });
        formWrap.querySelector('#bd-color-clear').addEventListener('click', () => {
          chosenColor = null;
          colorInput.value = HOLIDAY_COLOR;
        });

        formWrap.querySelector('#bd-cancel').addEventListener('click', closeForm);
        if (existing) {
          formWrap.querySelector('#bd-delete').addEventListener('click', () => {
            Store.saveBirthdays(userId, Store.getBirthdays(userId).filter(b => b.id !== existing.id));
            closeForm();
            renderList();
            Calendar.render();
          });
        }
        formWrap.querySelector('#bd-save').addEventListener('click', () => {
          const name = formWrap.querySelector('#bd-name').value.trim();
          if (!name) return;
          const month = parseInt(formWrap.querySelector('#bd-month').value, 10);
          const day = parseInt(formWrap.querySelector('#bd-day').value, 10);
          const yearRaw = formWrap.querySelector('#bd-year').value.trim();
          const year = yearRaw ? parseInt(yearRaw, 10) : null;
          const list = Store.getBirthdays(userId);
          Store.saveBirthdays(userId, existing
            ? list.map(b => b.id === existing.id ? { ...b, name, month, day, year, color: chosenColor } : b)
            : [...list, { id: uid(), name, month, day, year, color: chosenColor }]);
          closeForm();
          renderList();
          Calendar.render();
        });
      }

      function renderList() {
        const list = Store.getBirthdays(userId).slice().sort((a, b) => a.month - b.month || a.day - b.day);
        listEl.innerHTML = list.length ? '' : '<p class="muted">No birthdays added yet.</p>';
        list.forEach(b => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'menu-item-row birthday-row';
          row.innerHTML = `
            <span class="icon-btn" style="pointer-events:none; color:${b.color || 'inherit'};">${icon('cake')}</span>
            <span style="flex:1; text-align:left;">${escapeHTML(b.name)} - ${MONTH_NAMES[b.month - 1]} ${b.day}${b.year ? ', ' + b.year : ''}</span>
          `;
          row.addEventListener('click', () => renderForm(b));
          listEl.appendChild(row);
        });
      }
      renderList();

      addBtn.addEventListener('click', () => renderForm(null));
    });
  },

  // Calendar tap-through: view a birthday. Editable only if you're the one
  // who added it -- a connection's entry (they added it, not you) is read-only.
  openBirthdayModal(ownerId, birthdayId) {
    const userId = Store.getCurrentUserId();
    const isOwner = ownerId === userId;
    const b = Store.getBirthdays(ownerId).find(x => x.id === birthdayId);
    if (!b) return;

    const body = `
      <div class="modal-header"><h2>Birthday</h2><button class="modal-close" id="bdm-close">${icon('x')}</button></div>
      <div class="field"><input type="text" id="bdm-name" placeholder="Name" value="${escapeAttr(b.name)}" ${isOwner ? '' : 'disabled'}></div>
      <div class="field-row">
        <select id="bdm-month" ${isOwner ? '' : 'disabled'}>${MONTH_OPTIONS}</select>
        <select id="bdm-day" ${isOwner ? '' : 'disabled'}>${DAY_OPTIONS}</select>
        <input type="number" id="bdm-year" placeholder="Year (optional)" ${isOwner ? '' : 'disabled'} ${b.year ? `value="${b.year}"` : ''}>
      </div>
      <div class="field-row" style="align-items:center;">
        <input type="color" id="bdm-color" class="color-box" value="${b.color || HOLIDAY_COLOR}" ${isOwner ? '' : 'disabled'}>
        ${isOwner ? `<button type="button" class="link-btn" id="bdm-color-clear">Use their usual color</button>` : ''}
      </div>
      <div class="btn-row">
        ${isOwner ? `<button class="btn btn-danger" id="bdm-delete">Delete</button>` : ''}
        ${isOwner ? `<button class="btn btn-primary" id="bdm-save">Save</button>` : ''}
      </div>
    `;
    openModal(body, root => {
      root.querySelector('#bdm-close').addEventListener('click', closeModal);
      root.querySelector('#bdm-month').value = b.month;
      root.querySelector('#bdm-day').value = b.day;
      if (!isOwner) return;

      let chosenColor = b.color || null;
      const colorInput = root.querySelector('#bdm-color');
      colorInput.addEventListener('input', e => { chosenColor = e.target.value; });
      root.querySelector('#bdm-color-clear').addEventListener('click', () => {
        chosenColor = null;
        colorInput.value = HOLIDAY_COLOR;
      });

      root.querySelector('#bdm-delete').addEventListener('click', () => {
        Store.saveBirthdays(ownerId, Store.getBirthdays(ownerId).filter(x => x.id !== b.id));
        closeModal();
        Calendar.render();
      });
      root.querySelector('#bdm-save').addEventListener('click', () => {
        const name = root.querySelector('#bdm-name').value.trim();
        if (!name) return;
        const month = parseInt(root.querySelector('#bdm-month').value, 10);
        const day = parseInt(root.querySelector('#bdm-day').value, 10);
        const yearRaw = root.querySelector('#bdm-year').value.trim();
        const year = yearRaw ? parseInt(yearRaw, 10) : null;
        Store.saveBirthdays(ownerId, Store.getBirthdays(ownerId).map(x => x.id === b.id ? { ...x, name, month, day, year, color: chosenColor } : x));
        closeModal();
        Calendar.render();
      });
    });
  },

  // Settings entry point: just a checklist of the built-in holiday defs --
  // a personal display preference, not owned/shared data like birthdays are.
  openHolidaysManager() {
    const userId = Store.getCurrentUserId();
    const body = `
      <div class="modal-header"><h2>Holidays</h2><button class="modal-close" id="hol-close">${icon('x')}</button></div>
      <p class="muted">Choose which holidays show up on your calendar.</p>
      <div class="field-row" style="align-items:center; margin-bottom:14px;">
        <input type="color" id="hol-color" class="color-box" value="${Store.getHolidayColor(userId) || HOLIDAY_COLOR}">
        <span class="muted">Color for holidays on your calendar</span>
      </div>
      <div id="hol-list"></div>
    `;
    openModal(body, root => {
      root.querySelector('#hol-close').addEventListener('click', closeModal);
      root.querySelector('#hol-color').addEventListener('input', e => {
        Store.saveHolidayColor(userId, e.target.value);
        Calendar.render();
      });
      const listEl = root.querySelector('#hol-list');
      const enabled = new Set(Store.getEnabledHolidays(userId));
      HOLIDAY_DEFS.forEach(h => {
        const row = document.createElement('label');
        row.className = 'checkbox-row';
        row.innerHTML = `<span>${h.emoji} ${escapeHTML(h.name)}</span><input type="checkbox" ${enabled.has(h.id) ? 'checked' : ''}>`;
        row.querySelector('input').addEventListener('change', e => {
          if (e.target.checked) enabled.add(h.id);
          else enabled.delete(h.id);
          Store.saveEnabledHolidays(userId, Array.from(enabled));
          Calendar.render();
        });
        listEl.appendChild(row);
      });
    });
  },

  // Holidays aren't owned or editable per-instance -- tapping one on the
  // calendar just confirms what it is; manage the list itself in Settings.
  openHolidayInfoModal(title) {
    openModal(`
      <div class="modal-header"><h2>Holiday</h2><button class="modal-close" id="holm-close">${icon('x')}</button></div>
      <p>${escapeHTML(title)}</p>
      <p class="muted">Manage which holidays show up in Settings.</p>
    `, root => root.querySelector('#holm-close').addEventListener('click', closeModal));
  },

  openEventModal(event, dateStr) {
    const userId = Store.getCurrentUserId();
    const people = Store.getKnownPeople(userId);
    // Participants (event ownership/authorship) is narrower than "everyone
    // I can see" -- only household co-members (mutual edit-trust) can be
    // picked, since a plain connection is visibility-only. Always includes
    // the event's current owner even if edit-trust was since revoked, so
    // editing an existing event never silently misrepresents who it's set to.
    const editablePeople = people.filter(p => p.id === userId || Store.isEditTrusted(p.id));
    if (event && !editablePeople.some(p => p.id === event.ownerId)) {
      const currentOwner = Store.getAccount(event.ownerId);
      if (currentOwner) editablePeople.push(currentOwner);
    }
    const categories = Store.getCategories();
    const isEdit = !!event;

    const type = event ? event.type : 'single';
    const baseDate = event ? (event.type === 'custom' ? (event.dates || [dateStr])[0] : event.date) : dateStr;

    const body = `
      <div class="modal-header"><h2>${isEdit ? 'Edit event' : 'Add event'}</h2><button class="modal-close" id="ev-close">${icon('x')}</button></div>
      <div class="field">
        <input type="text" id="ev-title" list="ev-title-presets" placeholder="Title" value="${event ? escapeAttr(event.title) : ''}">
        <datalist id="ev-title-presets">${Store.getEventPresets(userId).map(p => `<option value="${escapeAttr(p.title)}">`).join('')}</datalist>
      </div>
      <div class="checkbox-row"><button type="button" class="link-btn" id="ev-save-preset">Save as preset</button></div>
      <div class="field-row">
        <div class="field"><button type="button" class="time-field-btn" id="ev-date-btn">${icon('calendar')}<span class="tf-text">${event && event.endDate && event.endDate !== baseDate ? formatDateRangeShort(baseDate, event.endDate) : formatDateShort(baseDate)}</span></button></div>
        <div class="field" id="ev-time-field"><button type="button" class="time-field-btn${event && event.time ? '' : ' placeholder'}" id="ev-time-btn">${icon('clock')}<span class="tf-text">${event && event.time ? formatTime12(event.time) : 'Add start time'}</span></button></div>
      </div>
      <div class="field-row">
        <div class="field" id="ev-repeat-field">
          <div class="repeat-field-row">
            <button type="button" class="time-field-btn" id="ev-repeat-btn" aria-label="Repeat">${icon('repeat')}<span class="tf-text">Repeat</span></button>
            <select id="ev-ends-type" class="hidden">
              <option value="never">Never ends</option>
              <option value="on">Ends on date</option>
              <option value="after"># of occurrences</option>
            </select>
            <button type="button" class="time-field-btn custom-dates-btn hidden placeholder" id="ev-custom-dates-btn"><span class="tf-text">No dates yet</span></button>
          </div>
          <div id="ev-ends-extra" class="hidden" style="margin-top:8px;">
            <button type="button" class="time-field-btn placeholder hidden" id="ev-ends-date-btn">${icon('calendar')}<span class="tf-text">Pick end date</span></button>
            <input type="number" id="ev-ends-count" class="hidden" min="1" placeholder="Occurrences">
          </div>
          <div id="ev-interval-extra" class="hidden" style="margin-top:8px; display:flex; gap:6px; align-items:center;">
            <span class="muted" style="font-size:13px;">Every</span>
            <input type="number" id="ev-interval-n" min="1" placeholder="9" style="width:60px;">
            <select id="ev-interval-unit">
              <option value="daily">days</option>
              <option value="weekly">weeks</option>
              <option value="monthly">months</option>
              <option value="yearly">years</option>
            </select>
          </div>
          <div id="ev-repeat-menu" class="repeat-menu hidden">
            <button type="button" class="menu-item" data-val="single">None</button>
            <button type="button" class="menu-item" data-val="daily">Daily</button>
            <button type="button" class="menu-item" data-val="weekly">Weekly</button>
            <button type="button" class="menu-item" data-val="monthly">Monthly</button>
            <button type="button" class="menu-item" data-val="yearly">Yearly</button>
            <button type="button" class="menu-item" data-val="custom-interval">Custom interval</button>
            <button type="button" class="menu-item" data-val="custom">Custom dates</button>
          </div>
        </div>
        <div class="field" id="ev-time-end-field"><button type="button" class="time-field-btn${event && event.endTime ? '' : ' placeholder'}" id="ev-time-end-btn">${icon('clock')}<span class="tf-text">${event && event.endTime ? formatTime12(event.endTime) : 'Add end time'}</span></button></div>
      </div>
      <div class="field" id="ev-reminder-field">
        <button type="button" class="time-field-btn placeholder" id="ev-reminder-btn">${icon('bell')}<span class="tf-text">Reminder</span></button>
        <div id="ev-reminder-menu" class="repeat-menu hidden">
          <button type="button" class="menu-item" data-val="none">None</button>
          <button type="button" class="menu-item" data-val="15">15 minutes before</button>
          <button type="button" class="menu-item" data-val="30">30 minutes before</button>
          <button type="button" class="menu-item" data-val="60">1 hour before</button>
          <button type="button" class="menu-item" data-val="1440">1 day before</button>
          <button type="button" class="menu-item" data-val="2880">2 days before</button>
          <button type="button" class="menu-item" data-val="custom">Custom</button>
          <div id="ev-reminder-custom-row" class="hidden" style="display:flex; gap:6px; padding:6px 10px 4px;">
            <input type="number" id="ev-reminder-custom-amount" min="1" placeholder="Amount" style="width:70px; padding:6px 8px; border-radius:8px; border:0.5px solid var(--border-strong); background:var(--surface-2); color:var(--text); font-size:16px;">
            <select id="ev-reminder-custom-unit" style="flex:1; padding:6px 8px; border-radius:8px; border:0.5px solid var(--border-strong); background:var(--surface-2); color:var(--text); font-size:16px;">
              <option value="minutes">minutes before</option>
              <option value="hours">hours before</option>
              <option value="days">days before</option>
            </select>
            <button type="button" class="btn" style="padding:4px 10px;" id="ev-reminder-custom-set">Set</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label>Participants</label>
        <div id="ev-owner-picker" class="people-picker">
          ${editablePeople.map(p => `<label><input type="checkbox" value="${p.id}" ${(event ? (event.participantIds || [event.ownerId]) : [userId]).includes(p.id) ? 'checked' : ''}> ${p.name}</label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Category</label>
        <input type="text" id="ev-category" list="ev-cat-list" value="${event && event.category ? escapeAttr(event.category) : ''}" placeholder="Category">
        <datalist id="ev-cat-list">${categories.map(c => `<option value="${c}">`).join('')}</datalist>
      </div>
      <div class="field">
        <div class="textarea-with-icon">
          ${icon('notes')}
          <textarea id="ev-notes" rows="1" placeholder="Add a note">${event && event.notes ? escapeAttr(event.notes) : ''}</textarea>
        </div>
      </div>
      <div class="field">
        <div class="attachment-box" id="ev-attachment-box">
          ${icon('paperclip')}
          <span class="attachment-box-label placeholder" id="ev-attachment-label">Add attachment (photo or file)</span>
          <button type="button" class="icon-btn hidden" id="ev-attachment-clear" aria-label="Remove attachment">${icon('x')}</button>
        </div>
        <input type="file" id="ev-attachment" accept="image/*,.pdf,.doc,.docx,.txt" class="hidden">
      </div>
      <div class="checkbox-row">
        <label for="ev-private">
          <input type="checkbox" id="ev-private" ${event && event.visibility === 'private' ? 'checked' : ''}>
          Private (only visible to me)
        </label>
      </div>
      <div class="btn-row">
        ${isEdit ? `<button class="btn btn-danger" id="ev-delete">Delete</button>` : ''}
        ${isEdit ? `<button class="btn" id="ev-copy">Copy</button>` : ''}
        <button class="btn btn-primary" id="ev-save">Save</button>
      </div>
    `;

    openModal(body, root => {
      root.querySelector('#ev-close').addEventListener('click', closeModal);

      let dateVal = baseDate;
      let throughVal = event && event.endDate && event.endDate !== baseDate ? event.endDate : null;
      const dateBtn = root.querySelector('#ev-date-btn');
      const timeField = root.querySelector('#ev-time-field');
      const timeEndField = root.querySelector('#ev-time-end-field');
      function refreshTimeFieldsVisibility() {
        const isSpan = !!(throughVal && throughVal > dateVal);
        timeField.classList.toggle('hidden', isSpan);
        timeEndField.classList.toggle('hidden', isSpan);
      }
      function updateDateBtnLabel() {
        dateBtn.querySelector('.tf-text').textContent = throughVal ? formatDateRangeShort(dateVal, throughVal) : formatDateShort(dateVal);
      }
      updateDateBtnLabel();
      refreshTimeFieldsVisibility();
      dateBtn.addEventListener('click', () => {
        openDatePicker(dateVal, throughVal, (start, end) => {
          dateVal = start;
          throughVal = end;
          updateDateBtnLabel();
          refreshTimeFieldsVisibility();
        });
      });

      let startTimeVal = event && event.time ? event.time : null;
      let endTimeVal = event && event.endTime ? event.endTime : null;
      const timeBtn = root.querySelector('#ev-time-btn');
      const timeEndBtn = root.querySelector('#ev-time-end-btn');
      timeBtn.addEventListener('click', () => {
        openTimePicker(startTimeVal, null, val => {
          startTimeVal = val;
          timeBtn.querySelector('.tf-text').textContent = val ? formatTime12(val) : 'Add start time';
          timeBtn.classList.toggle('placeholder', !val);
        });
      });
      timeEndBtn.addEventListener('click', () => {
        openTimePicker(endTimeVal, null, val => {
          endTimeVal = val;
          timeEndBtn.querySelector('.tf-text').textContent = val ? formatTime12(val) : 'Add end time';
          timeEndBtn.classList.toggle('placeholder', !val);
        });
      });

      // Presets: typing a title that matches a saved preset (new events only,
      // so editing an existing event's title never silently overwrites its
      // real time/category) fills in the rest for you.
      const titleInput = root.querySelector('#ev-title');
      const categoryInput = root.querySelector('#ev-category');
      if (!isEdit) {
        titleInput.addEventListener('input', () => {
          const match = Store.getEventPresets(userId).find(p => p.title.toLowerCase() === titleInput.value.trim().toLowerCase());
          if (!match) return;
          if (match.time) {
            startTimeVal = match.time;
            timeBtn.querySelector('.tf-text').textContent = formatTime12(match.time);
            timeBtn.classList.remove('placeholder');
          }
          if (match.endTime) {
            endTimeVal = match.endTime;
            timeEndBtn.querySelector('.tf-text').textContent = formatTime12(match.endTime);
            timeEndBtn.classList.remove('placeholder');
          }
          if (match.category) categoryInput.value = match.category;
        });
      }

      const savePresetBtn = root.querySelector('#ev-save-preset');
      savePresetBtn.addEventListener('click', () => {
        const title = titleInput.value.trim();
        if (!title) { titleInput.focus(); return; }
        const category = categoryInput.value.trim() || null;
        const presets = Store.getEventPresets(userId);
        const idx = presets.findIndex(p => p.title.toLowerCase() === title.toLowerCase());
        const preset = { id: idx >= 0 ? presets[idx].id : uid(), title, time: startTimeVal, endTime: endTimeVal, category };
        if (idx >= 0) presets[idx] = preset; else presets.push(preset);
        Store.saveEventPresets(userId, presets);
        savePresetBtn.textContent = 'Saved!';
        setTimeout(() => { savePresetBtn.textContent = 'Save as preset'; }, 1200);
      });

      const REMINDER_LABELS = { 15: '15 minutes before', 30: '30 minutes before', 60: '1 hour before', 1440: '1 day before', 2880: '2 days before' };
      function formatReminderLabel(minutes) {
        if (minutes == null) return 'Reminder';
        if (REMINDER_LABELS[minutes]) return REMINDER_LABELS[minutes];
        if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes / 1440 === 1 ? '' : 's'} before`;
        if (minutes % 60 === 0) return `${minutes / 60} hour${minutes / 60 === 1 ? '' : 's'} before`;
        return `${minutes} minute${minutes === 1 ? '' : 's'} before`;
      }
      // Reminders are per-viewer -- this is *my* reminder preference for this
      // event, independent of anyone else who can also see it. Changes save
      // immediately via Store.setMyReminder rather than waiting for the main
      // Save button, so they can never be clobbered by (or clobber) someone
      // else's concurrent edit to the same event.
      let reminderVal = event && event.reminders && event.reminders[userId] != null ? event.reminders[userId] : null;
      const reminderBtn = root.querySelector('#ev-reminder-btn');
      const reminderMenu = root.querySelector('#ev-reminder-menu');
      const reminderCustomRow = root.querySelector('#ev-reminder-custom-row');
      const reminderCustomAmount = root.querySelector('#ev-reminder-custom-amount');
      const reminderCustomUnit = root.querySelector('#ev-reminder-custom-unit');
      function refreshReminderUI() {
        const isSet = reminderVal != null;
        const isPreset = isSet && REMINDER_LABELS[reminderVal] !== undefined;
        const key = !isSet ? 'none' : (isPreset ? String(reminderVal) : 'custom');
        reminderBtn.querySelector('.tf-text').textContent = formatReminderLabel(reminderVal);
        reminderBtn.classList.toggle('placeholder', !isSet);
        reminderMenu.querySelectorAll('.menu-item').forEach(mi => mi.classList.toggle('selected', mi.dataset.val === key));
      }
      refreshReminderUI();
      reminderBtn.addEventListener('click', () => reminderMenu.classList.toggle('hidden'));
      reminderMenu.querySelectorAll('.menu-item').forEach(mi => {
        mi.addEventListener('click', () => {
          if (mi.dataset.val === 'custom') {
            reminderCustomRow.classList.toggle('hidden');
            if (!reminderCustomRow.classList.contains('hidden')) reminderCustomAmount.focus();
            return;
          }
          reminderCustomRow.classList.add('hidden');
          reminderVal = mi.dataset.val === 'none' ? null : parseInt(mi.dataset.val, 10);
          reminderMenu.classList.add('hidden');
          refreshReminderUI();
          if (isEdit) Store.setMyReminder(event.id, userId, reminderVal);
        });
      });
      function commitCustomReminder() {
        const amount = parseInt(reminderCustomAmount.value, 10);
        if (!amount || amount < 1) return;
        const mult = reminderCustomUnit.value === 'days' ? 1440 : reminderCustomUnit.value === 'hours' ? 60 : 1;
        reminderVal = amount * mult;
        reminderCustomRow.classList.add('hidden');
        reminderMenu.classList.add('hidden');
        reminderCustomAmount.value = '';
        refreshReminderUI();
        if (isEdit) Store.setMyReminder(event.id, userId, reminderVal);
      }
      reminderCustomRow.querySelector('#ev-reminder-custom-set').addEventListener('click', commitCustomReminder);
      reminderCustomAmount.addEventListener('keydown', e => { if (e.key === 'Enter') commitCustomReminder(); });

      let attachmentVal = event && event.attachment ? event.attachment : null;
      const attachmentInput = root.querySelector('#ev-attachment');
      const attachmentBox = root.querySelector('#ev-attachment-box');
      const attachmentLabel = root.querySelector('#ev-attachment-label');
      const attachmentClear = root.querySelector('#ev-attachment-clear');
      function refreshAttachmentPreview() {
        attachmentLabel.textContent = attachmentVal ? attachmentVal.name : 'Add attachment (photo or file)';
        attachmentLabel.classList.toggle('placeholder', !attachmentVal);
        attachmentClear.classList.toggle('hidden', !attachmentVal);
      }
      refreshAttachmentPreview();
      attachmentBox.addEventListener('click', e => {
        if (attachmentClear.contains(e.target)) return;
        attachmentInput.click();
      });
      attachmentInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          attachmentVal = { name: file.name, type: file.type, dataUrl: reader.result };
          refreshAttachmentPreview();
        };
        reader.readAsDataURL(file);
      });
      attachmentClear.addEventListener('click', e => {
        e.stopPropagation();
        attachmentVal = null;
        attachmentInput.value = '';
        refreshAttachmentPreview();
      });

      let repeatVal = type === 'custom' ? 'custom'
        : (type === 'recurring' && event ? (event.recurrence.interval > 1 ? 'custom-interval' : event.recurrence.freq) : 'single');
      const repeatBtn = root.querySelector('#ev-repeat-btn');
      const repeatMenu = root.querySelector('#ev-repeat-menu');
      const REPEAT_LABELS = { single: 'None', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly', custom: 'Custom dates' };
      const endsType = root.querySelector('#ev-ends-type');
      const endsExtra = root.querySelector('#ev-ends-extra');
      const endsDateBtn = root.querySelector('#ev-ends-date-btn');
      const endsCount = root.querySelector('#ev-ends-count');
      const customDatesBtn = root.querySelector('#ev-custom-dates-btn');
      const intervalExtra = root.querySelector('#ev-interval-extra');
      const intervalN = root.querySelector('#ev-interval-n');
      const intervalUnit = root.querySelector('#ev-interval-unit');
      if (repeatVal === 'custom-interval') {
        intervalN.value = event.recurrence.interval;
        intervalUnit.value = event.recurrence.freq;
      }
      const privateCb = root.querySelector('#ev-private');

      let endsDateVal = type === 'recurring' && event && event.recurrence.until ? event.recurrence.until : null;
      function refreshEndsDateBtn() {
        endsDateBtn.querySelector('.tf-text').textContent = endsDateVal ? formatDateShort(endsDateVal) : 'Pick end date';
        endsDateBtn.classList.toggle('placeholder', !endsDateVal);
      }
      refreshEndsDateBtn();
      endsDateBtn.addEventListener('click', () => {
        openDatePicker(endsDateVal || dateVal, null, picked => {
          endsDateVal = picked;
          refreshEndsDateBtn();
        }, { single: true });
      });

      if (type === 'recurring' && event) {
        if (event.recurrence.until) { endsType.value = 'on'; }
        else if (event.recurrence.count) { endsType.value = 'after'; endsCount.value = event.recurrence.count; }
      }

      let customDatesVal = type === 'custom' && event ? (event.dates || []).slice() : [];
      function refreshCustomDatesBtn() {
        const text = customDatesBtn.querySelector('.tf-text');
        text.textContent = customDatesVal.length ? customDatesVal.slice().sort().map(formatDateNumeric).join(', ') : 'No dates yet';
        customDatesBtn.classList.toggle('placeholder', !customDatesVal.length);
      }
      refreshCustomDatesBtn();
      customDatesBtn.addEventListener('click', () => {
        openMultiDatePicker(customDatesVal, picked => {
          customDatesVal = picked;
          refreshCustomDatesBtn();
        });
      });

      function refreshRepeatUI() {
        const showEnds = repeatVal !== 'single' && repeatVal !== 'custom';
        const isRepeating = repeatVal !== 'single';
        repeatBtn.classList.toggle('icon-only', isRepeating);
        repeatBtn.querySelector('.tf-text').classList.toggle('hidden', isRepeating);
        repeatBtn.classList.toggle('placeholder', !isRepeating);
        repeatBtn.classList.toggle('active', isRepeating);
        repeatBtn.title = repeatVal === 'custom-interval'
          ? `Repeat: Every ${intervalN.value || '?'} ${intervalUnit.options[intervalUnit.selectedIndex].text}`
          : `Repeat: ${REPEAT_LABELS[repeatVal]}`;
        endsType.classList.toggle('hidden', !showEnds);
        customDatesBtn.classList.toggle('hidden', repeatVal !== 'custom');
        intervalExtra.classList.toggle('hidden', repeatVal !== 'custom-interval');
        repeatMenu.querySelectorAll('.menu-item').forEach(mi => mi.classList.toggle('selected', mi.dataset.val === repeatVal));
        refreshEndsUI();
      }
      repeatBtn.addEventListener('click', () => repeatMenu.classList.toggle('hidden'));
      repeatMenu.querySelectorAll('.menu-item').forEach(mi => {
        mi.addEventListener('click', () => {
          repeatVal = mi.dataset.val;
          repeatMenu.classList.add('hidden');
          refreshRepeatUI();
        });
      });
      intervalN.addEventListener('input', refreshRepeatUI);
      intervalUnit.addEventListener('change', refreshRepeatUI);

      function refreshEndsUI() {
        const showEnds = repeatVal !== 'single' && repeatVal !== 'custom';
        endsExtra.classList.toggle('hidden', !showEnds || endsType.value === 'never');
        endsDateBtn.classList.toggle('hidden', endsType.value !== 'on');
        endsCount.classList.toggle('hidden', endsType.value !== 'after');
      }
      endsType.addEventListener('change', refreshEndsUI);
      refreshRepeatUI();

      if (isEdit) {
        root.querySelector('#ev-delete').addEventListener('click', () => {
          if (type === 'recurring' || type === 'custom') {
            Calendar.openDeleteChoiceModal(event, dateStr);
          } else {
            Store.deleteEvent(event.id);
            closeModal();
            Calendar.render();
          }
        });
        root.querySelector('#ev-copy').addEventListener('click', () => {
          openMultiDatePicker([], picked => {
            picked.forEach(d => {
              Store.addEvent({
                id: uid(),
                title: event.title, date: d, endDate: null,
                time: event.time, endTime: event.endTime,
                ownerId: event.ownerId, participantIds: event.participantIds || [event.ownerId], category: event.category,
                visibility: event.visibility, customPeople: event.customPeople || [],
                notes: event.notes, attachment: event.attachment, reminders: { ...event.reminders },
                order: Date.now(),
                exceptions: [], type: 'single', recurrence: null,
              });
            });
            closeModal();
            Calendar.render();
          }, event.date);
        });
      }

      root.querySelector('#ev-save').addEventListener('click', () => {
        const title = root.querySelector('#ev-title').value.trim();
        if (!title) return;
        const date = dateVal;
        const time = startTimeVal;
        const endTime = endTimeVal;
        const participantIds = Array.from(root.querySelectorAll('#ev-owner-picker input:checked')).map(i => i.value);
        if (!participantIds.length) participantIds.push(userId);
        const ownerId = participantIds[0];
        const category = root.querySelector('#ev-category').value.trim() || null;
        if (category) Store.addCategory(category);

        const visibility = privateCb.checked ? 'private' : 'shared';
        const customPeople = [];

        const notes = root.querySelector('#ev-notes').value.trim() || null;
        const endDate = (throughVal && throughVal > date) ? throughVal : null;
        let newEvent = {
          id: event ? event.id : uid(),
          title, date, endDate, time, endTime, ownerId, participantIds, category, visibility, customPeople,
          notes, attachment: attachmentVal,
          order: event ? event.order : Date.now(),
          exceptions: event ? (event.exceptions || []) : [],
        };
        // Reminders already saved live via setMyReminder as they're changed
        // (see above) -- only set the initial map here for a brand-new event,
        // where there's no risk yet of clobbering anyone else's setting.
        if (!isEdit) newEvent.reminders = reminderVal != null ? { [userId]: reminderVal } : {};

        if (repeatVal === 'single') {
          newEvent.type = 'single';
          newEvent.recurrence = null;
        } else if (repeatVal === 'custom') {
          newEvent.type = 'custom';
          newEvent.dates = Array.from(new Set([date, ...customDatesVal]));
          newEvent.recurrence = null;
        } else {
          newEvent.type = 'recurring';
          const freq = repeatVal === 'custom-interval' ? intervalUnit.value : repeatVal;
          const interval = repeatVal === 'custom-interval' ? Math.max(1, parseInt(intervalN.value, 10) || 1) : 1;
          const rule = { freq, interval, until: null, count: null };
          if (endsType.value === 'on' && endsDateVal) rule.until = endsDateVal;
          if (endsType.value === 'after' && endsCount.value) rule.count = parseInt(endsCount.value, 10);
          newEvent.recurrence = rule;
        }

        if (isEdit) Store.updateEvent(event.id, newEvent);
        else Store.addEvent(newEvent);

        closeModal();
        Calendar.render();
      });
    });
  },

  openDeleteChoiceModal(event, occurrenceDate) {
    const body = `
      <div class="modal-header"><h2>Delete event</h2><button class="modal-close" id="dc-close">${icon('x')}</button></div>
      <p class="muted">This event repeats. What do you want to delete?</p>
      <div class="btn-row" style="flex-direction:column;">
        <button class="btn" id="dc-one">Just this one</button>
        <button class="btn" id="dc-future">This and future</button>
        <button class="btn btn-danger" id="dc-all">Entire series</button>
      </div>
    `;
    openModal(body, root => {
      root.querySelector('#dc-close').addEventListener('click', closeModal);
      root.querySelector('#dc-one').addEventListener('click', () => {
        if (event.type === 'custom') {
          Store.updateEvent(event.id, { dates: (event.dates || []).filter(d => d !== occurrenceDate) });
        } else {
          Store.updateEvent(event.id, { exceptions: [...(event.exceptions || []), occurrenceDate] });
        }
        closeModal();
        Calendar.render();
      });
      root.querySelector('#dc-future').addEventListener('click', () => {
        if (event.type === 'custom') {
          Store.updateEvent(event.id, { dates: (event.dates || []).filter(d => d < occurrenceDate) });
        } else {
          const untilDate = addToDate(parseISO(occurrenceDate), event.recurrence.freq, -(event.recurrence.interval || 1));
          Store.updateEvent(event.id, { recurrence: { ...event.recurrence, until: formatISO(untilDate), count: null } });
        }
        closeModal();
        Calendar.render();
      });
      root.querySelector('#dc-all').addEventListener('click', () => {
        Store.deleteEvent(event.id);
        closeModal();
        Calendar.render();
      });
    });
  },
};

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
