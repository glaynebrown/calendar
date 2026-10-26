// Georgia is a system font (installed everywhere already) -- no Google
// Fonts entry needed for it, unlike every other option here.
const FONT_OPTIONS = ['Inter', 'Nunito', 'Quicksand', 'Poppins', 'Comfortaa', 'Lato', 'Work Sans', 'Baloo 2', 'Georgia', 'Lora'];
const BG_COLOR_OPTIONS = ['#f4f3ef', '#f6efe9'];
const BORDER_COLOR_OPTIONS = ['#ffffff', '#000000', '#f4f3ef', '#2c2b25'];

function applyFont(theme) {
  document.documentElement.style.setProperty('--font-app', `'${theme.font || 'Inter'}', system-ui, sans-serif`);
}

function applyAccent(theme) {
  document.documentElement.style.setProperty('--accent', (theme && theme.accent) || '#71816C');
}

// theme.colorMode: 'light' (default), 'dark', or 'system' (follows the device setting).
function applyColorMode(theme) {
  const mode = (theme && theme.colorMode) || 'light';
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
}

const BG_FIT_SIZES = { fit: 'auto 100%', crop: 'cover', stretch: '100% 100%' };

// theme.textColor: null (default, use normal theme colors), 'white', 'black',
// or a custom hex string. Resolves to the actual CSS color to apply, or null.
function resolveTextColor(textColor) {
  if (!textColor || textColor === 'default') return null;
  if (textColor === 'white') return '#ffffff';
  if (textColor === 'black') return '#000000';
  return textColor;
}

// Default/White/Black/Custom swatches for the text-color control, shared by
// Settings (this device) and the per-month background modal.
function renderTextColorGrid(idPrefix, currentValue) {
  const val = currentValue || 'default';
  const isCustom = val !== 'default' && val !== 'white' && val !== 'black';
  return `
    <div class="bg-color-grid" id="${idPrefix}-grid">
      <button type="button" class="bg-color-swatch text-color-swatch${val === 'default' ? ' selected' : ''}" data-c="default" title="Default">Aa</button>
      <button type="button" class="bg-color-swatch white-swatch${val === 'white' ? ' selected' : ''}" data-c="white" style="background:#fff;" title="White"></button>
      <button type="button" class="bg-color-swatch${val === 'black' ? ' selected' : ''}" data-c="black" style="background:#000;" title="Black"></button>
      <span class="color-box color-wheel-trigger${isCustom ? ' selected' : ''}" title="Custom">
        <input type="color" id="${idPrefix}-custom" value="${isCustom ? val : '#000000'}">
      </span>
    </div>
  `;
}

function applyBackground(bg) {
  bg = bg || {};
  const body = document.body;
  const app = document.getElementById('app');
  document.documentElement.classList.toggle('bg-through-grid', !!bg.bgThroughGrid);
  const resolvedTextColor = resolveTextColor(bg.textColor);
  if (resolvedTextColor) {
    document.documentElement.style.setProperty('--text-override', resolvedTextColor);
    document.documentElement.classList.add('has-text-override');
  } else {
    document.documentElement.classList.remove('has-text-override');
  }
  document.documentElement.classList.toggle('text-white', bg.textColor === 'white');
  if (bg.bgPhoto) {
    const photoSize = BG_FIT_SIZES[bg.bgFit] || BG_FIT_SIZES.fit;
    body.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.55), rgba(255,255,255,0.55)), url(${bg.bgPhoto})`;
    body.style.backgroundSize = `100% 100%, ${photoSize}`;
    body.style.backgroundPosition = 'center, center';
    body.style.backgroundRepeat = 'no-repeat, no-repeat';
    body.style.backgroundColor = bg.bgBorderColor || bg.bgAutoColor || bg.bgColor || '';
    document.documentElement.style.removeProperty('--bg');
    app.style.background = 'transparent';
  } else if (bg.bgColor) {
    body.style.backgroundImage = 'none';
    body.style.backgroundColor = '';
    document.documentElement.style.setProperty('--bg', bg.bgColor);
    app.style.background = '';
  } else {
    body.style.backgroundImage = 'none';
    body.style.backgroundColor = '';
    document.documentElement.style.removeProperty('--bg');
    app.style.background = '';
  }
}

// Samples a downsampled copy of the image to get a representative average
// color, used to fill any gap left by a fit mode that doesn't cover the
// whole screen (so the edge blends with the photo instead of showing a
// generic page color).
function extractAverageColor(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    const toHex = v => Math.round(v / n).toString(16).padStart(2, '0');
    callback(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
  };
  img.src = dataUrl;
}

// Downscales and re-encodes an uploaded photo before it's ever stored --
// Firestore hard-caps every document at 1MiB, and a photo straight off a
// phone camera can easily be several MB as a raw base64 data URL (confirmed
// the hard way: two uncompressed month photos alone filled 880KB of the
// shared preferences document). 1600px on the longer side and JPEG at 0.75
// quality keeps a background photo comfortably under a few hundred KB while
// still looking sharp at any screen size this app runs at, and the same
// helper covers event attachments (see calendar.js) so a photo attached to
// an event can't silently blow past that event's own document limit either.
function compressImageDataUrl(dataUrl, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Could not load image for compression'));
    img.src = dataUrl;
  });
}

function applyBackgroundForMonth(monthIndex) {
  const override = Store.getMonthTheme(String(monthIndex));
  const resolved = override ? { ...Store.getTheme(), ...override } : Store.getTheme();
  applyBackground(resolved);
  applyAccent(resolved);
}

// Planner has its own optional third tier: planner override -> month override -> global default.
function applyBackgroundForPlanner(monthIndex) {
  const plannerOverride = Store.getPlannerMonthTheme(String(monthIndex));
  if (!plannerOverride) { applyBackgroundForMonth(monthIndex); return; }
  const monthOverride = Store.getMonthTheme(String(monthIndex));
  const resolved = { ...Store.getTheme(), ...(monthOverride || {}), ...plannerOverride };
  applyBackground(resolved);
  applyAccent(resolved);
}

// One background/text/accent editor block (text, accent, background color,
// background photo + fit, show-through toggle), reused for both the month
// theme and the planner-specific override so they stay visually identical.
function themeEditorHTML(idPrefix, existing, fallbackTheme, throughLabel) {
  return `
    <div class="appearance-row">
      <div class="field">
        <label>Text</label>
        ${renderTextColorGrid(`${idPrefix}-text`, existing && existing.textColor)}
      </div>
      <div class="field">
        <label>Accent</label>
        <input type="color" id="${idPrefix}-accent" class="color-box" value="${(existing && existing.accent) || fallbackTheme.accent || '#71816C'}">
      </div>
      <div class="field">
        <label>Background</label>
        <div class="bg-color-grid" id="${idPrefix}-bg-grid">
          ${BG_COLOR_OPTIONS.map(c => `<button type="button" class="bg-color-swatch" data-c="${c}" style="background:${c}"></button>`).join('')}
          <span class="color-box color-wheel-trigger" title="Pick any color">
            <input type="color" id="${idPrefix}-color" value="${(existing && existing.bgColor) || '#f4f3ef'}">
          </span>
        </div>
      </div>
      <div class="field">
        <label>Background photo</label>
        <div class="file-btn-row">
          <button type="button" class="time-field-btn icon-only${existing && existing.bgPhoto ? ' active' : ''}" id="${idPrefix}-photo-btn" aria-label="Choose background photo">${icon('image')}</button>
          <button type="button" class="icon-btn${existing && existing.bgPhoto ? '' : ' hidden'}" id="${idPrefix}-photo-clear" aria-label="Remove photo">${icon('x')}</button>
        </div>
        <input type="file" id="${idPrefix}-photo" accept="image/*" class="hidden">
      </div>
    </div>
    <div class="field">
      <select id="${idPrefix}-fit" class="${existing && existing.bgPhoto ? '' : 'hidden'}" style="margin-top:8px;">
        <option value="fit" ${!existing || !existing.bgFit || existing.bgFit === 'fit' ? 'selected' : ''}>Fit top to bottom</option>
        <option value="crop" ${existing && existing.bgFit === 'crop' ? 'selected' : ''}>Crop to fill screen</option>
        <option value="stretch" ${existing && existing.bgFit === 'stretch' ? 'selected' : ''}>Stretch to fill</option>
      </select>
      <p class="muted" id="${idPrefix}-border-note" style="margin-top:6px; ${existing && existing.bgPhoto ? '' : 'display:none;'}">If the photo doesn't fill the screen, the color above fills the rest.</p>
      <label class="switch-row" id="${idPrefix}-through-row" style="margin-top:10px;">
        <span>${throughLabel}</span>
        <span class="switch">
          <input type="checkbox" id="${idPrefix}-through-grid" ${(existing && existing.bgThroughGrid !== undefined ? existing.bgThroughGrid : fallbackTheme.bgThroughGrid) ? 'checked' : ''}>
          <span class="switch-track"></span>
        </span>
      </label>
    </div>
  `;
}

// Wires up one themeEditorHTML block. Returns { getTheme() } to read the
// current field values back out when saving.
function wireThemeEditor(root, idPrefix, existing) {
  let photoDataUrl = existing && existing.bgPhoto ? existing.bgPhoto : null;
  let textColorVal = (existing && existing.textColor) || null;
  const fitSelect = root.querySelector(`#${idPrefix}-fit`);
  const borderNote = root.querySelector(`#${idPrefix}-border-note`);
  const colorInput = root.querySelector(`#${idPrefix}-color`);
  const accentInput = root.querySelector(`#${idPrefix}-accent`);
  const throughCheckbox = root.querySelector(`#${idPrefix}-through-grid`);

  const bgGrid = root.querySelector(`#${idPrefix}-bg-grid`);
  function refreshBgGrid() {
    bgGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.c === colorInput.value);
    });
  }
  refreshBgGrid();
  bgGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
    btn.addEventListener('click', () => { colorInput.value = btn.dataset.c; refreshBgGrid(); });
  });
  colorInput.addEventListener('input', refreshBgGrid);

  const textGrid = root.querySelector(`#${idPrefix}-text-grid`);
  const textCustomInput = root.querySelector(`#${idPrefix}-text-custom`);
  function refreshTextGrid() {
    const current = textColorVal || 'default';
    const isCustom = current !== 'default' && current !== 'white' && current !== 'black';
    textGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.c === current);
    });
    textGrid.querySelector('.color-wheel-trigger').classList.toggle('selected', isCustom);
  }
  textGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
    btn.addEventListener('click', () => { textColorVal = btn.dataset.c === 'default' ? null : btn.dataset.c; refreshTextGrid(); });
  });
  textCustomInput.addEventListener('input', e => { textColorVal = e.target.value; refreshTextGrid(); });

  const photoInput = root.querySelector(`#${idPrefix}-photo`);
  const photoBtn = root.querySelector(`#${idPrefix}-photo-btn`);
  const photoClearBtn = root.querySelector(`#${idPrefix}-photo-clear`);
  photoBtn.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      compressImageDataUrl(reader.result, 1600, 0.75).then(compressed => {
        photoDataUrl = compressed;
        extractAverageColor(photoDataUrl, hex => { colorInput.value = hex; refreshBgGrid(); });
        photoBtn.classList.add('active');
        photoClearBtn.classList.remove('hidden');
        fitSelect.classList.remove('hidden');
        borderNote.style.display = '';
      }).catch(() => {
        alert("Couldn't process that photo -- try a different one.");
      });
    };
    reader.readAsDataURL(file);
  });
  photoClearBtn.addEventListener('click', () => {
    photoDataUrl = null;
    photoInput.value = '';
    photoBtn.classList.remove('active');
    photoClearBtn.classList.add('hidden');
    fitSelect.classList.add('hidden');
    borderNote.style.display = 'none';
  });

  return {
    getTheme() {
      return {
        bgColor: colorInput.value,
        bgPhoto: photoDataUrl,
        bgFit: fitSelect.value,
        bgThroughGrid: throughCheckbox.checked,
        textColor: textColorVal,
        accent: accentInput.value,
      };
    },
  };
}

function applyTheme(theme) {
  applyFont(theme);
  applyAccent(theme);
  applyBackground(theme);
  applyColorMode(theme);
}

const Settings = {
  init() {
    onTap(document.getElementById('settings-btn'), () => this.openModal());
    onTap(document.getElementById('todo-settings-btn'), () => this.openModal());
  },

  // startPage: which Settings page to open on ('menu' by default) -- the
  // invite sheet uses it to come back to People when it's closed.
  openModal(startPage) {
    const userId = Store.getCurrentUserId();
    const knownPeople = Store.getKnownPeople(userId).filter(p => p.id !== userId);
    const me = Store.getPerson(userId);
    const theme = Store.getTheme();

    // iPhone-style: a short menu of rows, each opening its own page inside
    // this same sheet (the rest of the pages stay hidden until tapped).
    const navRow = (page, iconName, label) => `
      <button type="button" class="st-row" data-go="${page}">
        <span class="st-row-icon">${icon(iconName)}</span>
        <span class="st-row-label">${label}</span>
        <span class="st-chev">${icon('chevron-right')}</span>
      </button>`;
    const pageHeader = (title, back) => `
      <div class="modal-header st-page-header">
        <button type="button" class="st-back" data-go="${back}" aria-label="Back">${icon('chevron-left')}<span>${back === 'menu' ? 'Settings' : 'People'}</span></button>
        <h2>${title}</h2>
        <button class="modal-close" data-close aria-label="Close">${icon('x')}</button>
      </div>`;

    const body = `
      <div class="st-page" data-page="menu">
        <div class="modal-header"><h2>Settings</h2><button class="modal-close" id="st-close" aria-label="Close">${icon('x')}</button></div>
        <div class="st-group">
          <button type="button" class="st-row st-row-profile" data-go="profile">
            <span class="avatar-mini st-profile-avatar" id="st-menu-avatar" style="background:${me ? me.defaultColor : '#888'}">${initials(me ? me.name : '')}</span>
            <span class="st-row-label"><span id="st-menu-name">${escapeHTML(me ? me.name : '')}</span><span class="st-row-sub">Name, color, sign out</span></span>
            <span class="st-chev">${icon('chevron-right')}</span>
          </button>
        </div>
        <div class="st-group">
          ${navRow('people', 'users', 'People')}
          ${navRow('calendar', 'calendar', 'Calendar')}
          ${navRow('birthdays', 'cake', 'Birthdays and holidays')}
        </div>
        <div class="st-group">
          ${navRow('notifications', 'bell', 'Notifications')}
          ${navRow('appearance', 'palette', 'Appearance')}
        </div>
      </div>

      <div class="st-page hidden" data-page="profile">
        ${pageHeader('My profile', 'menu')}
        <p class="muted" style="margin-top:0;">Tap your circle to change your color.</p>
        <div class="file-btn-row">
          <span class="avatar-color-wrap">
            <span class="avatar-mini avatar-color-btn" id="st-my-avatar" style="background:${me ? me.defaultColor : '#888'}">${initials(me ? me.name : '')}</span>
            <input type="color" id="st-my-color-input" class="color-input-overlay" aria-label="Change your color" value="${me ? me.defaultColor : '#888888'}">
          </span>
          <input type="text" id="st-my-name" style="flex:1;" value="${escapeAttr(me ? me.name : '')}">
        </div>
        <button type="button" class="link-btn" id="st-sign-out" style="margin-top:10px;">Sign out</button>
      </div>

      <div class="st-page hidden" data-page="people">
        ${pageHeader('People', 'menu')}

        <div class="st-card">
          <div class="st-card-title">Household</div>
          <div class="st-perms">
            <span class="perm-chip">${icon('check')}See</span>
            <span class="perm-chip">${icon('check')}Add</span>
            <span class="perm-chip">${icon('check')}Edit and delete</span>
          </div>
          <p class="st-card-note">For people you live with. You can add, edit, and delete each other's events.</p>
          <div id="st-households-list"></div>
          <div id="st-create-household-wrap" class="field-row" style="margin-top:8px;">
            <input type="text" id="st-household-name" placeholder="Household name">
            <button class="btn" id="st-create-household">Create</button>
          </div>
        </div>

        <div class="st-card">
          <div class="st-card-title">Connections</div>
          <div class="st-perms">
            <span class="perm-chip">${icon('check')}See</span>
            <span class="perm-chip">${icon('check')}Add</span>
            <span class="perm-chip perm-chip-soft">Fix only what you added</span>
          </div>
          <p class="st-card-note">You can see each other's events and add to each other's calendars. Each person can only change or delete the events they added.</p>
          <div id="st-connections-card"></div>
        </div>

        <div class="st-card">
          <div class="st-card-title">Viewers</div>
          <div class="st-perms">
            <span class="perm-chip">${icon('check')}See</span>
            <span class="perm-chip perm-chip-soft">Only what's shared</span>
          </div>
          <p class="st-card-note">You see the events you each share. Neither of you can add or change anything.</p>
          <div id="st-viewers-list"></div>
        </div>

        <button type="button" class="btn btn-primary st-invite-btn" id="st-invite">${icon('user-plus')}<span>Invite someone</span></button>
        <p class="muted st-people-hint">Tap someone's circle to change the color you see them as.</p>

        <div class="st-group">
          <button type="button" class="st-row" id="st-accept-toggle">
            <span class="st-row-label">Have an invite link?</span>
            <span class="st-chev">${icon('chevron-right')}</span>
          </button>
          <div id="st-accept-wrap" class="st-row-body hidden">
            <div class="field-row">
              <input type="text" id="st-accept-code" placeholder="Paste invite link">
              <button class="btn" id="st-accept-code-btn">Join</button>
            </div>
            <p class="muted" id="st-accept-result" style="margin:6px 0 0;"></p>
          </div>
          <button type="button" class="st-row" data-go="order">
            <span class="st-row-label">People order</span>
            <span class="st-chev">${icon('chevron-right')}</span>
          </button>
        </div>
      </div>

      <div class="st-page hidden" data-page="order">
        ${pageHeader('People order', 'people')}
        <p class="muted" style="margin-top:0;">Drag to set the order people appear in when you pick them, like the Participants list on an event. Only you see this order. You always come first.</p>
        <div id="st-people-order-list"></div>
        ${knownPeople.length === 0 ? '<p class="muted">Nobody to reorder yet.</p>' : ''}
      </div>

      <div class="st-page hidden" data-page="calendar">
        ${pageHeader('Calendar', 'menu')}
        <label class="switch-row" id="st-viewmode-row">
          <span>View Menu: use checkboxes instead of named views</span>
          <span class="switch">
            <input type="checkbox" id="st-viewmode-toggle" ${Store.getViewMode(userId) === 'checklist' ? 'checked' : ''}>
            <span class="switch-track"></span>
          </span>
        </label>
        <label class="switch-row" id="st-wishlists-row" style="margin-top:10px;">
          <span>Show Wishwell wishlists on birthdays</span>
          <span class="switch">
            <input type="checkbox" id="st-wishlists-toggle" ${Store.getShowWishlists(userId) ? 'checked' : ''}>
            <span class="switch-track"></span>
          </span>
        </label>
        <label class="switch-row" id="st-event-colors-row" style="margin-top:10px;">
          <span>Show colored backgrounds/borders on events</span>
          <span class="switch">
            <input type="checkbox" id="st-event-colors-toggle" ${Store.getShowEventColors(userId) ? 'checked' : ''}>
            <span class="switch-track"></span>
          </span>
        </label>
        <div class="field" style="margin-top:10px;">
          <label>Event text color (month view)</label>
          <select id="st-event-text-mode" ${Store.getShowEventColors(userId) ? '' : 'disabled'}>
            <option value="colored" ${Store.getEventTextMode(userId) === 'colored' ? 'selected' : ''}>Colored</option>
            <option value="white" ${Store.getEventTextMode(userId) === 'white' ? 'selected' : ''}>Always white</option>
            <option value="black" ${Store.getEventTextMode(userId) === 'black' ? 'selected' : ''}>Always black</option>
          </select>
        </div>
        <div class="field" style="margin-top:14px;">
          <label>Default calendar view</label>
          <select id="st-default-calendar-view">
            ${[
              ['month', 'Month'], ['week', 'Week'],
              ['day-everyone', 'Day (everyone)'], ['planner', 'Planner'],
            ].map(([val, label]) => `<option value="${val}" ${Store.getDefaultCalendarView(userId) === val ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="st-page hidden" data-page="birthdays">
        ${pageHeader('Birthdays and holidays', 'menu')}
        <div class="st-group">
          <button type="button" class="st-row" id="st-birthdays-btn">
            <span class="st-row-icon">${icon('cake')}</span>
            <span class="st-row-label">Birthdays<span class="st-row-sub">Add birthdays and choose who sees them</span></span>
            <span class="st-chev">${icon('chevron-right')}</span>
          </button>
          <button type="button" class="st-row" id="st-holidays-btn">
            <span class="st-row-icon">${icon('flag')}</span>
            <span class="st-row-label">Holidays<span class="st-row-sub">Pick which holidays show</span></span>
            <span class="st-chev">${icon('chevron-right')}</span>
          </button>
        </div>
      </div>

      <div class="st-page hidden" data-page="notifications">
        ${pageHeader('Notifications', 'menu')}
        <label class="switch-row" id="st-notif-row">
          <span>Reminder notifications on this device</span>
          <span class="switch">
            <input type="checkbox" id="st-notif-toggle">
            <span class="switch-track"></span>
          </span>
        </label>
        <p class="muted" id="st-notif-status" style="margin-top:6px;"></p>
      </div>

      <div class="st-page hidden" data-page="appearance">
        ${pageHeader('Appearance', 'menu')}
        <p class="muted" style="margin-top:0;">These only change this device.</p>
        <div class="field">
          <label>Color mode</label>
          <select id="st-color-mode">
            ${[
              ['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device setting'],
            ].map(([val, label]) => `<option value="${val}" ${(theme.colorMode || 'light') === val ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="appearance-row">
          <div class="field appearance-font">
            <label>Font</label>
            <select id="st-font">${FONT_OPTIONS.map(f => `<option value="${f}" ${theme.font === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label>Text</label>
            ${renderTextColorGrid('st-text', theme.textColor)}
          </div>
        </div>
        <div class="appearance-row">
          <div class="field">
            <label>Accent</label>
            <input type="color" id="st-accent-custom" class="color-box" value="${theme.accent || '#71816C'}" title="Accent color (add button, today's date, highlights)">
          </div>
          <div class="field">
            <label>Background</label>
            <div class="bg-color-grid" id="st-bg-grid">
              ${BG_COLOR_OPTIONS.map(c => `<button type="button" class="bg-color-swatch" data-c="${c}" style="background:${c}"></button>`).join('')}
              <span class="color-box color-wheel-trigger" title="Pick any color">
                <input type="color" id="st-bg-custom" value="${theme.bgColor || '#f4f3ef'}">
              </span>
            </div>
          </div>
          <div class="field">
            <label>Background photo</label>
            <div class="file-btn-row">
              <button type="button" class="time-field-btn icon-only${theme.bgPhoto ? ' active' : ''}" id="st-bg-photo-btn" aria-label="Choose background photo">${icon('image')}</button>
              <button type="button" class="icon-btn${theme.bgPhoto ? '' : ' hidden'}" id="st-bg-photo-clear" aria-label="Remove photo">${icon('x')}</button>
            </div>
            <input type="file" id="st-bg-photo" accept="image/*" class="hidden">
          </div>
        </div>
        <div class="field">
          <select id="st-bg-fit" class="${theme.bgPhoto ? '' : 'hidden'}" style="margin-top:8px;">
            <option value="fit" ${theme.bgFit === 'fit' || !theme.bgFit ? 'selected' : ''}>Fit top to bottom</option>
            <option value="crop" ${theme.bgFit === 'crop' ? 'selected' : ''}>Crop to fill screen</option>
            <option value="stretch" ${theme.bgFit === 'stretch' ? 'selected' : ''}>Stretch to fill</option>
          </select>
          <div id="st-border-wrap" class="${theme.bgPhoto ? '' : 'hidden'}" style="margin-top:10px;">
            <label>Color on the sides (if the photo doesn't fill it)</label>
            <div class="bg-color-grid" id="st-border-grid">
              ${BORDER_COLOR_OPTIONS.map(c => `<button type="button" class="bg-color-swatch" data-c="${c}" style="background:${c}"></button>`).join('')}
              <span class="color-box color-wheel-trigger" title="Pick any color">
                <input type="color" id="st-border-custom" value="${theme.bgBorderColor || '#888888'}">
              </span>
            </div>
          </div>
          <label class="switch-row" style="margin-top:10px;">
            <span>Show background behind the calendar too</span>
            <span class="switch">
              <input type="checkbox" id="st-bg-through-grid" ${theme.bgThroughGrid ? 'checked' : ''}>
              <span class="switch-track"></span>
            </span>
          </label>
        </div>
      </div>
    `;

    openModal(body, root => {
      const sheet = root.querySelector('.modal-sheet');
      const showPage = page => {
        root.querySelectorAll('.st-page').forEach(p => p.classList.toggle('hidden', p.dataset.page !== page));
        if (sheet) sheet.scrollTop = 0;
      };
      root.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.go)));
      root.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModal));
      showPage(startPage || 'menu');

      root.querySelector('#st-close').addEventListener('click', closeModal);

      root.querySelector('#st-sign-out').addEventListener('click', async () => {
        await firebase.auth().signOut();
        location.reload();
      });

      root.querySelector('#st-my-name').addEventListener('change', e => {
        const newName = e.target.value.trim() || me.name;
        Store.updatePerson(userId, { name: newName });
        root.querySelector('#st-my-avatar').textContent = initials(newName);
        root.querySelector('#st-menu-avatar').textContent = initials(newName);
        root.querySelector('#st-menu-name').textContent = newName;
        Calendar.render();
      });
      const myAvatarBtn = root.querySelector('#st-my-avatar');
      const myColorInput = root.querySelector('#st-my-color-input');
      myColorInput.addEventListener('input', e => {
        Store.updatePerson(userId, { defaultColor: e.target.value });
        myAvatarBtn.style.background = e.target.value;
        root.querySelector('#st-menu-avatar').style.background = e.target.value;
        Calendar.render();
      });

      root.querySelector('#st-viewmode-toggle').addEventListener('change', e => {
        Store.setViewMode(userId, e.target.checked ? 'checklist' : 'named');
        Calendar.render();
      });

      const eventTextModeSelect = root.querySelector('#st-event-text-mode');
      root.querySelector('#st-wishlists-toggle').addEventListener('change', e => {
        Store.setShowWishlists(userId, e.target.checked);
      });
      root.querySelector('#st-event-colors-toggle').addEventListener('change', e => {
        Store.setShowEventColors(userId, e.target.checked);
        eventTextModeSelect.disabled = !e.target.checked;
        Calendar.render();
      });
      eventTextModeSelect.addEventListener('change', e => {
        Store.setEventTextMode(userId, e.target.value);
        Calendar.render();
      });

      const notifToggle = root.querySelector('#st-notif-toggle');
      const notifStatus = root.querySelector('#st-notif-status');
      (async () => {
        const supported = 'Notification' in window && 'serviceWorker' in navigator
          && firebase.messaging.isSupported && await firebase.messaging.isSupported();
        if (!supported) {
          notifToggle.disabled = true;
          notifStatus.textContent = "Not supported in this browser. On iPhone, first add this app to your Home Screen (Share → Add to Home Screen), then enable notifications from there.";
        } else if (Notification.permission === 'denied') {
          notifToggle.disabled = true;
          notifStatus.textContent = 'Notifications are blocked for this site — enable them in your browser/device settings, then reopen Settings.';
        } else {
          notifToggle.checked = Notification.permission === 'granted';
        }
      })();
      notifToggle.addEventListener('change', async e => {
        const enabling = e.target.checked;
        try {
          const registration = await navigator.serviceWorker.ready;
          if (enabling) {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
              e.target.checked = false;
              notifStatus.textContent = 'Permission was not granted.';
              return;
            }
            const token = await firebase.messaging().getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
            Store.addDeviceToken(userId, token);
            notifStatus.textContent = 'Enabled on this device.';
          } else {
            const token = await firebase.messaging().getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
            Store.removeDeviceToken(userId, token);
            notifStatus.textContent = 'Disabled on this device.';
          }
        } catch (err) {
          notifStatus.textContent = `Something went wrong: ${err.message}`;
        }
      });

      root.querySelector('#st-default-calendar-view').addEventListener('change', e => {
        Store.setDefaultCalendarView(userId, e.target.value);
      });

      root.querySelector('#st-holidays-btn').addEventListener('click', () => Calendar.openHolidaysManager());
      root.querySelector('#st-birthdays-btn').addEventListener('click', () => Calendar.openBirthdaysManager());

      function inviteUrl(code) {
        return `${location.origin}${location.pathname}?invite=${code}`;
      }
      function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }

      const nameOf = id => (Store.getAccount(id) || {}).name || '?';
      // Tap-to-change color circle, used for everyone on the People page.
      const colorAvatar = id => {
        const c = Store.colorFor(userId, id);
        return `<span class="avatar-color-wrap">
          <span class="avatar-mini avatar-color-btn" style="background:${c};">${initials(nameOf(id))}</span>
          <input type="color" class="avatar-color-input color-input-overlay" data-color-for="${id}" aria-label="Change ${escapeAttr(nameOf(id))}'s color" value="${c}">
        </span>`;
      };
      const wireColorInputs = el => {
        el.querySelectorAll('[data-color-for]').forEach(input => {
          input.addEventListener('input', e => {
            Store.setColorForPerson(userId, input.dataset.colorFor, e.target.value);
            input.closest('.avatar-color-wrap').querySelector('.avatar-color-btn').style.background = e.target.value;
            Calendar.render();
          });
        });
      };
      const personRow = (id, sub, actionLabel) => `
        <div class="st-person">
          ${id === userId
            ? `<span class="avatar-mini" style="background:${me ? me.defaultColor : '#888'};">${initials(nameOf(id))}</span>`
            : colorAvatar(id)}
          <span class="st-person-name">${escapeHTML(nameOf(id))}${id === userId ? ' <span class="muted">(you)</span>' : ''}${sub ? `<span class="st-row-sub">${escapeHTML(sub)}</span>` : ''}</span>
          ${actionLabel ? `<button type="button" class="link-btn st-remove" data-person="${id}">${actionLabel}</button>` : ''}
        </div>`;

      function renderHouseholds() {
        const listEl = root.querySelector('#st-households-list');
        const households = Store.getHouseholdsFor(userId);
        root.querySelector('#st-create-household-wrap').classList.toggle('hidden', households.length > 0);
        listEl.innerHTML = households.length ? '' : '<p class="st-empty">Create a household, then invite the people you live with.</p>';
        households.forEach(h => {
          const wrap = document.createElement('div');
          wrap.className = 'st-household';
          wrap.innerHTML = `
            ${households.length > 1 ? `<p class="st-household-name">${escapeHTML(h.name)}</p>` : ''}
            ${h.memberIds.map(id => personRow(id, '', id === userId ? 'Leave' : 'Remove')).join('')}
          `;
          wireColorInputs(wrap);
          wrap.querySelectorAll('.st-remove').forEach(btn => {
            btn.addEventListener('click', () => {
              const memberId = btn.dataset.person;
              const isLeave = memberId === userId;
              const confirmMsg = isLeave
                ? `Leave "${h.name}"? You'll lose shared access with everyone in it.`
                : `Remove ${nameOf(memberId)} from "${h.name}"?`;
              if (!confirm(confirmMsg)) return;
              Store.removeHouseholdMember(h.id, memberId);
              renderPeople();
              Calendar.render();
            });
          });
          listEl.appendChild(wrap);
        });
      }

      // Connections: everyone tied by a connection invite to you or anyone
      // in your household (see Store.isConnectionPair), whichever side
      // sent the invite.
      function renderConnectionsCard() {
        const el = root.querySelector('#st-connections-card');
        const circle = new Set([userId]);
        Store.getHouseholdsFor(userId).forEach(h => h.memberIds.forEach(id => circle.add(id)));
        const tiedTo = new Map();
        circle.forEach(cid => Store.connectionsOf(cid).forEach(other => {
          if (circle.has(other)) return;
          tiedTo.set(other, [...(tiedTo.get(other) || []), cid]);
        }));
        // People whose events you can see through a connection (e.g. Jo on
        // a family event Bella tagged) but who aren't one of your own people
        // -- otherwise there'd be nowhere to pick their color.
        const knownIds = new Set(Store.getKnownPeople(userId).map(p => p.id));
        const others = Store.connectionsOf(userId).length
          ? Array.from(new Set(Store.getEvents().map(e => e.ownerId))).filter(id => id && !knownIds.has(id) && !tiedTo.has(id) && Store.getAccount(id))
          : [];
        const rows = [...tiedTo].map(([id, ofIds]) => personRow(id,
          `Connected to ${ofIds.map(x => (x === userId ? 'you' : nameOf(x))).join(', ')}`, 'Remove')).join('');
        el.innerHTML = `
          ${rows || '<p class="st-empty">No connections yet.</p>'}
          ${others.length ? `<p class="st-subhead">Others on events you can see</p>${others.map(id => personRow(id, '', '')).join('')}` : ''}
        `;
        wireColorInputs(el);
        el.querySelectorAll('.st-remove').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.person;
            if (!confirm(`Remove ${nameOf(id)} as a connection? You'll stop seeing each other's events and can't add to each other's calendars anymore.`)) return;
            Store.removeViewer(id);
            renderPeople();
            Calendar.render();
          });
        });
      }

      // Viewers: plain 1:1 links (stored as `connections`) -- everyone you
      // know who isn't in your household or tied to you as a connection.
      function renderViewersCard() {
        const listEl = root.querySelector('#st-viewers-list');
        const skip = new Set(Store.getHouseholdsFor(userId).flatMap(h => h.memberIds));
        Store.viewersOf(userId).forEach(id => skip.add(id));
        Store.viewedBy(userId).forEach(id => skip.add(id));
        const people = Store.getKnownPeople(userId).filter(p => p.id !== userId && !skip.has(p.id));
        listEl.innerHTML = people.length ? people.map(p => personRow(p.id, '', 'Remove')).join('') : '<p class="st-empty">No viewers yet.</p>';
        wireColorInputs(listEl);
        listEl.querySelectorAll('.st-remove').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.person;
            if (!confirm(`Remove ${nameOf(id)} as a viewer? You'll stop seeing each other's shared events.`)) return;
            Store.removeConnection(userId, id);
            renderPeople();
            Calendar.render();
          });
        });
      }

      // Flat list of everyone known, in this user's own custom order (see
      // Store.getPersonOrder) -- feeds Store.getKnownPeople everywhere it's
      // used, including the event editor's Participants picker.
      function renderPeopleOrder() {
        const listEl = root.querySelector('#st-people-order-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        Store.getKnownPeople(userId).filter(p => p.id !== userId).forEach(p => {
          const row = document.createElement('div');
          row.className = 'color-swatch-row sortable-item';
          row.dataset.id = p.id;
          const viewColor = Store.colorFor(userId, p.id);
          row.innerHTML = `
            <button type="button" class="drag-handle" aria-label="Reorder ${escapeAttr(p.name)}">${icon('grip')}</button>
            <div class="color-swatch-row-left" style="flex:1;">
              <span class="avatar-mini" style="background:${viewColor};">${initials(p.name)}</span>
              <span>${escapeHTML(p.name)}</span>
            </div>
          `;
          listEl.appendChild(row);
        });
      }
      makeSortable(root.querySelector('#st-people-order-list'), orderedIds => {
        Store.setPersonOrder(userId, orderedIds);
        renderPeopleOrder();
      });

      function renderPeople() {
        renderHouseholds();
        renderConnectionsCard();
        renderViewersCard();
        renderPeopleOrder();
      }
      renderPeople();

      root.querySelector('#st-create-household').addEventListener('click', () => {
        const nameInput = root.querySelector('#st-household-name');
        const name = nameInput.value.trim();
        if (!name) return;
        Store.createHousehold(name, userId);
        nameInput.value = '';
        renderPeople();
      });

      root.querySelector('#st-accept-toggle').addEventListener('click', () => {
        root.querySelector('#st-accept-wrap').classList.toggle('hidden');
      });
      root.querySelector('#st-accept-code-btn').addEventListener('click', async () => {
        const raw = root.querySelector('#st-accept-code').value.trim();
        const code = raw.includes('invite=') ? raw.split('invite=')[1].split('&')[0] : raw;
        const resultEl = root.querySelector('#st-accept-result');
        if (!code) return;
        const result = await Store.acceptInvite(code, userId);
        if (result.ok) {
          resultEl.textContent = 'You\'re in.';
          root.querySelector('#st-accept-code').value = '';
          renderPeople();
          Calendar.render();
        } else {
          resultEl.textContent = result.reason;
        }
      });

      root.querySelector('#st-invite').addEventListener('click', () => openInvite());

      // One invite button for all three kinds -- the person inviting picks
      // what the other person should be able to do, so nobody has to
      // remember which word means what.
      function openInvite() {
        const households = Store.getHouseholdsFor(userId);
        const circle = new Set([userId]);
        households.forEach(h => h.memberIds.forEach(id => circle.add(id)));
        const people = Array.from(circle).map(id => Store.getAccount(id)).filter(Boolean)
          .sort((a, b) => (a.id === userId ? -1 : b.id === userId ? 1 : 0));
        const option = (kind, title, desc, extra) => `
          <label class="st-invite-opt" data-kind="${kind}">
            <span class="st-invite-opt-head"><input type="radio" name="inv-kind" value="${kind}"><span>${title}</span></span>
            <span class="st-row-sub">${desc}</span>
            ${extra ? `<div class="st-invite-extra hidden">${extra}</div>` : ''}
          </label>`;
        const householdExtra = households.length > 1
          ? `<label class="st-row-sub" style="display:block;margin:8px 0 4px;">Which household?</label>
             <select id="inv-household">${households.map(h => `<option value="${h.id}">${escapeHTML(h.name)}</option>`).join('')}</select>`
          : households.length ? '' : `<p class="st-row-sub" style="margin:8px 0 0;">Create your household first on the People page.</p>`;
        const connectionExtra = `
          <span class="st-row-sub" style="display:block;margin:8px 0 2px;">Connect them to:</span>
          ${people.map(p => `<label class="st-check"><input type="checkbox" class="inv-person" value="${p.id}" ${p.id === userId ? 'checked' : ''}><span>${escapeHTML(p.name)}${p.id === userId ? ' (you)' : ''}</span></label>`).join('')}`;

        openModal(`
          <div class="modal-header"><h2>Invite someone</h2><button class="modal-close" id="inv-close" aria-label="Close">${icon('x')}</button></div>
          <p style="margin:0 0 10px;">What should they be able to do?</p>
          ${option('household', 'Household', "Add, edit, and delete each other's events. For people you live with.", householdExtra)}
          ${option('connection', 'Connection', "See each other's events and add to each other's calendars. Each person can only change what they added.", connectionExtra)}
          ${option('viewer', 'Viewer', 'Only see the events you each share. Neither of you can change anything.', '')}
          <p class="muted hidden" id="inv-error" style="color:var(--text-danger,#c0392b);margin:4px 0 0;"></p>
          <button class="btn btn-primary" id="inv-create" style="width:100%;margin-top:10px;">Create invite link</button>
          <div id="inv-result" class="hidden" style="margin-top:12px;">
            <p class="muted" style="margin:0 0 6px;">Send this link to them:</p>
            <div class="field-row">
              <input type="text" id="inv-link" readonly style="flex:1;">
              <button class="btn" id="inv-copy">Copy</button>
            </div>
            <p class="muted hidden" id="inv-copied" style="margin:6px 0 0;">Copied.</p>
            <button type="button" class="link-btn hidden" id="inv-revoke">Get a new link (the old one stops working)</button>
          </div>
        `, r => {
          const close = () => { closeModal(); Settings.openModal('people'); };
          r.querySelector('#inv-close').addEventListener('click', close);
          const errorEl = r.querySelector('#inv-error');
          const createBtn = r.querySelector('#inv-create');
          const resultEl = r.querySelector('#inv-result');
          const showError = msg => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
          let kind = null;
          let viewerCode = null;
          r.querySelectorAll('input[name="inv-kind"]').forEach(radio => {
            radio.addEventListener('change', () => {
              kind = radio.value;
              r.querySelectorAll('.st-invite-opt').forEach(opt => {
                const on = opt.dataset.kind === kind;
                opt.classList.toggle('selected', on);
                const extra = opt.querySelector('.st-invite-extra');
                if (extra) extra.classList.toggle('hidden', !on);
              });
              errorEl.classList.add('hidden');
              resultEl.classList.add('hidden');
              createBtn.classList.remove('hidden');
              createBtn.disabled = false;
            });
          });
          r.querySelectorAll('.inv-person').forEach(cb => cb.addEventListener('change', () => errorEl.classList.add('hidden')));
          const showLink = code => {
            r.querySelector('#inv-link').value = inviteUrl(code);
            r.querySelector('#inv-copied').classList.add('hidden');
            r.querySelector('#inv-revoke').classList.toggle('hidden', kind !== 'viewer');
            resultEl.classList.remove('hidden');
            createBtn.classList.add('hidden');
          };
          createBtn.addEventListener('click', async () => {
            if (!kind) { showError('Pick one of the options first.'); return; }
            let code = null;
            createBtn.disabled = true;
            try {
              if (kind === 'household') {
                if (!households.length) { showError('Create your household first on the People page.'); createBtn.disabled = false; return; }
                const sel = r.querySelector('#inv-household');
                code = await Store.getOrCreateInvite('household_connect', userId, sel ? sel.value : households[0].id);
              } else if (kind === 'connection') {
                const ofIds = Array.from(r.querySelectorAll('.inv-person:checked')).map(cb => cb.value);
                if (!ofIds.length) { showError('Pick at least one person to connect them to.'); createBtn.disabled = false; return; }
                code = await Store.createViewerInvite(userId, ofIds);
              } else {
                code = viewerCode = await Store.getOrCreateInvite('individual_connect', userId);
              }
            } catch (err) {
              createBtn.disabled = false;
              showError("Couldn't create the link. Check your connection and try again.");
              return;
            }
            showLink(code);
          });
          r.querySelector('#inv-copy').addEventListener('click', () => {
            const input = r.querySelector('#inv-link');
            copyToClipboard(input.value);
            input.select();
            r.querySelector('#inv-copied').classList.remove('hidden');
          });
          r.querySelector('#inv-revoke').addEventListener('click', async () => {
            if (!confirm('Make a new link? Anyone who has the old one won\'t be able to use it.')) return;
            try {
              if (viewerCode) await Store.revokeInvite(viewerCode);
              viewerCode = await Store.getOrCreateInvite('individual_connect', userId);
              showLink(viewerCode);
            } catch (err) {
              showError("Couldn't make a new link. Check your connection and try again.");
            }
          });
        });
      }

      const bgGrid = root.querySelector('#st-bg-grid');
      function refreshBgGrid(selectedColor) {
        bgGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
          btn.classList.toggle('selected', btn.dataset.c === (selectedColor || ''));
        });
      }
      refreshBgGrid(theme.bgPhoto ? '' : theme.bgColor || '');
      bgGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          const newTheme = { ...Store.getTheme(), bgColor: btn.dataset.c || null, bgPhoto: null };
          Store.saveTheme(newTheme);
          applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
          refreshBgGrid(btn.dataset.c);
        });
      });
      root.querySelector('#st-bg-custom').addEventListener('input', e => {
        const newTheme = { ...Store.getTheme(), bgColor: e.target.value, bgPhoto: null };
        Store.saveTheme(newTheme);
        applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
        refreshBgGrid('');
      });

      root.querySelector('#st-accent-custom').addEventListener('input', e => {
        const newTheme = { ...Store.getTheme(), accent: e.target.value };
        Store.saveTheme(newTheme);
        applyAccent(newTheme);
      });

      root.querySelector('#st-font').addEventListener('change', e => {
        const newTheme = { ...Store.getTheme(), font: e.target.value };
        Store.saveTheme(newTheme);
        applyFont(newTheme);
      });

      root.querySelector('#st-color-mode').addEventListener('change', e => {
        const newTheme = { ...Store.getTheme(), colorMode: e.target.value };
        Store.saveTheme(newTheme);
        applyColorMode(newTheme);
      });

      const bgFitSelect = root.querySelector('#st-bg-fit');
      const borderWrap = root.querySelector('#st-border-wrap');
      const borderGrid = root.querySelector('#st-border-grid');
      function refreshBorderGrid() {
        const current = Store.getTheme().bgBorderColor || '';
        borderGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
          btn.classList.toggle('selected', btn.dataset.c === current);
        });
      }
      refreshBorderGrid();
      borderGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          const newTheme = { ...Store.getTheme(), bgBorderColor: btn.dataset.c || null };
          Store.saveTheme(newTheme);
          applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
          refreshBorderGrid();
        });
      });
      root.querySelector('#st-border-custom').addEventListener('input', e => {
        const newTheme = { ...Store.getTheme(), bgBorderColor: e.target.value };
        Store.saveTheme(newTheme);
        applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
        refreshBorderGrid();
      });

      const textGrid = root.querySelector('#st-text-grid');
      const textCustomInput = root.querySelector('#st-text-custom');
      function refreshTextGrid() {
        const current = Store.getTheme().textColor || 'default';
        const isCustom = current !== 'default' && current !== 'white' && current !== 'black';
        textGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
          btn.classList.toggle('selected', btn.dataset.c === current);
        });
        textGrid.querySelector('.color-wheel-trigger').classList.toggle('selected', isCustom);
      }
      textGrid.querySelectorAll('.bg-color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          const newTheme = { ...Store.getTheme(), textColor: btn.dataset.c === 'default' ? null : btn.dataset.c };
          Store.saveTheme(newTheme);
          applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
          refreshTextGrid();
        });
      });
      textCustomInput.addEventListener('input', e => {
        const newTheme = { ...Store.getTheme(), textColor: e.target.value };
        Store.saveTheme(newTheme);
        applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
        refreshTextGrid();
      });

      const bgPhotoInput = root.querySelector('#st-bg-photo');
      const bgPhotoBtn = root.querySelector('#st-bg-photo-btn');
      const bgPhotoClear = root.querySelector('#st-bg-photo-clear');
      bgPhotoBtn.addEventListener('click', () => bgPhotoInput.click());
      bgPhotoInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          compressImageDataUrl(reader.result, 1600, 0.75).then(photoDataUrl => {
            extractAverageColor(photoDataUrl, avgColor => {
              const newTheme = { ...Store.getTheme(), bgPhoto: photoDataUrl, bgColor: null, bgAutoColor: avgColor, bgFit: Store.getTheme().bgFit || 'fit' };
              Store.saveTheme(newTheme);
              applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
              refreshBgGrid('');
              bgPhotoBtn.classList.add('active');
              bgPhotoClear.classList.remove('hidden');
              bgFitSelect.classList.remove('hidden');
              borderWrap.classList.remove('hidden');
            });
          }).catch(() => {
            alert("Couldn't process that photo -- try a different one.");
          });
        };
        reader.readAsDataURL(file);
      });
      bgPhotoClear.addEventListener('click', () => {
        const newTheme = { ...Store.getTheme(), bgPhoto: null, bgAutoColor: null };
        Store.saveTheme(newTheme);
        applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
        bgPhotoInput.value = '';
        bgPhotoBtn.classList.remove('active');
        bgPhotoClear.classList.add('hidden');
        bgFitSelect.classList.add('hidden');
        borderWrap.classList.add('hidden');
      });
      bgFitSelect.addEventListener('change', e => {
        const newTheme = { ...Store.getTheme(), bgFit: e.target.value };
        Store.saveTheme(newTheme);
        applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
      });

      root.querySelector('#st-bg-through-grid').addEventListener('change', e => {
        const newTheme = { ...Store.getTheme(), bgThroughGrid: e.target.checked };
        Store.saveTheme(newTheme);
        applyBackgroundForMonth(Calendar.getRelevantMonthIndex());
      });
    });
  },
};

function initials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
