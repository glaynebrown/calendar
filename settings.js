const FONT_OPTIONS = ['Inter', 'Nunito', 'Quicksand', 'Poppins', 'Comfortaa', 'Lato', 'Work Sans', 'Baloo 2'];
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
      photoDataUrl = reader.result;
      extractAverageColor(photoDataUrl, hex => { colorInput.value = hex; refreshBgGrid(); });
      photoBtn.classList.add('active');
      photoClearBtn.classList.remove('hidden');
      fitSelect.classList.remove('hidden');
      borderNote.style.display = '';
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
    document.getElementById('settings-btn').addEventListener('click', () => this.openModal());
    document.getElementById('todo-settings-btn').addEventListener('click', () => this.openModal());
  },

  openModal() {
    const userId = Store.getCurrentUserId();
    const knownPeople = Store.getKnownPeople(userId).filter(p => p.id !== userId);
    const me = Store.getPerson(userId);
    const theme = Store.getTheme();

    const body = `
      <div class="modal-header"><h2>Settings</h2><button class="modal-close" id="st-close">${icon('x')}</button></div>

      <div class="settings-section">
        <h3>My profile</h3>
        <div class="file-btn-row">
          <span class="avatar-color-wrap">
            <span class="avatar-mini avatar-color-btn" id="st-my-avatar" style="background:${me ? me.defaultColor : '#888'}">${initials(me ? me.name : '')}</span>
            <input type="color" id="st-my-color-input" class="color-input-overlay" aria-label="Change your color" value="${me ? me.defaultColor : '#888888'}">
          </span>
          <input type="text" id="st-my-name" style="flex:1;" value="${escapeAttr(me ? me.name : '')}">
        </div>
        <button type="button" class="link-btn" id="st-sign-out" style="margin-top:10px;">Sign out</button>
      </div>

      <div class="settings-section">
        <h3>Household</h3>
        <p class="muted" style="margin-top:-4px;">Everyone in a household can see and add events for each other -- this is what you'll mainly use.</p>
        <div id="st-households-list"></div>
        <div class="field-row">
          <input type="text" id="st-household-name" placeholder="Household name (e.g. The Browns)">
          <button class="btn" id="st-create-household">Create</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Connections (visibility only)</h3>
        <p class="muted" style="margin-top:-4px;">Connect with individuals, one at a time -- they can see your calendar, but can't add events for you.</p>
        ${knownPeople.length ? '<p class="muted">Tap someone\'s icon to change the color you see them as.</p>' : ''}
        <div id="st-connections-list"></div>
        ${knownPeople.length === 0 ? '<p class="muted">No connections yet.</p>' : ''}
        <p class="muted" style="margin-top:10px;">Send this link to anyone you want to connect with:</p>
        <div class="field-row">
          <input type="text" id="st-my-invite-link" readonly style="flex:1;">
          <button class="btn" id="st-copy-invite">Copy</button>
        </div>
        <button type="button" class="link-btn" id="st-revoke-invite">Revoke and get a new link</button>
        <div class="field" style="margin-top:12px;">
          <label>Have an invite link?</label>
          <div class="field-row">
            <input type="text" id="st-accept-code" placeholder="Paste invite link">
            <button class="btn" id="st-accept-code-btn">Connect</button>
          </div>
          <p class="muted" id="st-accept-result"></p>
        </div>
      </div>

      <div class="settings-section">
        <h3>Calendar</h3>
        <label class="switch-row" id="st-viewmode-row">
          <span>View Menu: use checkboxes instead of named views</span>
          <span class="switch">
            <input type="checkbox" id="st-viewmode-toggle" ${Store.getViewMode(userId) === 'checklist' ? 'checked' : ''}>
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
        <div class="field" style="margin-top:14px;">
          <label>Default calendar view</label>
          <select id="st-default-calendar-view">
            ${[
              ['month', 'Month'], ['week', 'Week'],
              ['day-everyone', 'Day (everyone)'], ['planner', 'Planner'],
            ].map(([val, label]) => `<option value="${val}" ${Store.getDefaultCalendarView(userId) === val ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="field-row" style="margin-top:12px;">
          <button type="button" class="btn" id="st-holidays-btn" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px;">
            ${icon('flag')}<span>Holidays</span>
          </button>
          <button type="button" class="btn" id="st-birthdays-btn" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px;">
            ${icon('cake')}<span>Birthdays</span>
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Notifications</h3>
        <label class="switch-row" id="st-notif-row">
          <span>Reminder notifications on this device</span>
          <span class="switch">
            <input type="checkbox" id="st-notif-toggle">
            <span class="switch-track"></span>
          </span>
        </label>
        <p class="muted" id="st-notif-status" style="margin-top:6px;"></p>
      </div>

      <div class="settings-section">
        <h3>Appearance (this device)</h3>
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
      root.querySelector('#st-close').addEventListener('click', closeModal);

      root.querySelector('#st-sign-out').addEventListener('click', async () => {
        await firebase.auth().signOut();
        location.reload();
      });

      root.querySelector('#st-my-name').addEventListener('change', e => {
        const newName = e.target.value.trim() || me.name;
        Store.updatePerson(userId, { name: newName });
        root.querySelector('#st-my-avatar').textContent = initials(newName);
        Calendar.render();
      });
      const myAvatarBtn = root.querySelector('#st-my-avatar');
      const myColorInput = root.querySelector('#st-my-color-input');
      myColorInput.addEventListener('input', e => {
        Store.updatePerson(userId, { defaultColor: e.target.value });
        myAvatarBtn.style.background = e.target.value;
        Calendar.render();
      });

      root.querySelector('#st-viewmode-toggle').addEventListener('change', e => {
        Store.setViewMode(userId, e.target.checked ? 'checklist' : 'named');
        Calendar.render();
      });

      root.querySelector('#st-event-colors-toggle').addEventListener('change', e => {
        Store.setShowEventColors(userId, e.target.checked);
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

      function renderConnections() {
        const listEl = root.querySelector('#st-connections-list');
        listEl.innerHTML = '';
        Store.getKnownPeople(userId).filter(p => p.id !== userId).forEach(p => {
          const row = document.createElement('div');
          row.className = 'color-swatch-row';
          const viewColor = Store.colorFor(userId, p.id);
          row.innerHTML = `
            <div class="color-swatch-row-left">
              <span class="avatar-color-wrap">
                <span class="avatar-mini avatar-color-btn" style="background:${p.defaultColor}; box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px ${viewColor};">${initials(p.name)}</span>
                <input type="color" class="avatar-color-input color-input-overlay" aria-label="Change ${escapeAttr(p.name)}'s color" value="${viewColor}">
              </span>
              <span>${p.name}</span>
            </div>
          `;
          const avatarBtn = row.querySelector('.avatar-color-btn');
          const colorInput = row.querySelector('.avatar-color-input');
          colorInput.addEventListener('input', e => {
            Store.setColorForPerson(userId, p.id, e.target.value);
            avatarBtn.style.boxShadow = `0 0 0 2px var(--surface), 0 0 0 4px ${e.target.value}`;
            Calendar.render();
          });
          const removeBtn = document.createElement('button');
          removeBtn.className = 'btn btn-danger';
          removeBtn.style.padding = '4px 10px';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', () => {
            if (!confirm(`Remove ${p.name} as a connection?`)) return;
            Store.removeConnection(userId, p.id);
            renderConnections();
            Calendar.render();
          });
          row.appendChild(removeBtn);
          listEl.appendChild(row);
        });
      }
      renderConnections();

      const inviteLinkInput = root.querySelector('#st-my-invite-link');
      Store.getOrCreateInvite('individual_connect', userId).then(code => { inviteLinkInput.value = inviteUrl(code); });
      root.querySelector('#st-copy-invite').addEventListener('click', () => copyToClipboard(inviteLinkInput.value));
      root.querySelector('#st-revoke-invite').addEventListener('click', async () => {
        const current = inviteLinkInput.value.split('invite=')[1];
        if (current) await Store.revokeInvite(current);
        inviteLinkInput.value = inviteUrl(await Store.getOrCreateInvite('individual_connect', userId));
      });

      root.querySelector('#st-accept-code-btn').addEventListener('click', async () => {
        const raw = root.querySelector('#st-accept-code').value.trim();
        const code = raw.includes('invite=') ? raw.split('invite=')[1].split('&')[0] : raw;
        const resultEl = root.querySelector('#st-accept-result');
        if (!code) return;
        const result = await Store.acceptInvite(code, userId);
        if (result.ok) {
          resultEl.textContent = 'Connected!';
          root.querySelector('#st-accept-code').value = '';
          renderConnections();
          renderHouseholds();
          Calendar.render();
        } else {
          resultEl.textContent = result.reason;
        }
      });

      function renderHouseholds() {
        const listEl = root.querySelector('#st-households-list');
        listEl.innerHTML = '';
        Store.getHouseholdsFor(userId).forEach(h => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'border:0.5px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px;';
          const memberRows = h.memberIds.map(id => {
            const a = Store.getAccount(id);
            const isMe = id === userId;
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:2px 0;">
                <span>${escapeAttr(a ? a.name : '?')}${isMe ? ' (you)' : ''}</span>
                <button type="button" class="link-btn" data-member-action="${isMe ? 'leave' : 'remove'}" data-member-id="${id}" style="color:var(--text-danger,#c0392b);">${isMe ? 'Leave' : 'Remove'}</button>
              </div>
            `;
          }).join('');
          wrap.innerHTML = `
            <p style="font-weight:500;margin:0 0 4px;">${escapeAttr(h.name)}</p>
            <div style="margin:0 0 8px;">${memberRows}</div>
            <button type="button" class="link-btn" data-action="connect">Copy invite link</button>
          `;
          wrap.querySelectorAll('[data-member-action]').forEach(btn => {
            btn.addEventListener('click', () => {
              const memberId = btn.dataset.memberId;
              const isLeave = btn.dataset.memberAction === 'leave';
              const memberAccount = Store.getAccount(memberId);
              const confirmMsg = isLeave
                ? `Leave "${h.name}"? You'll lose shared access with everyone in it.`
                : `Remove ${memberAccount ? memberAccount.name : 'this person'} from "${h.name}"?`;
              if (!confirm(confirmMsg)) return;
              Store.removeHouseholdMember(h.id, memberId);
              renderHouseholds();
              Calendar.render();
            });
          });
          wrap.querySelector('[data-action="connect"]').addEventListener('click', async () => {
            const code = await Store.getOrCreateInvite('household_connect', userId, h.id);
            copyToClipboard(inviteUrl(code));
          });
          listEl.appendChild(wrap);
        });
      }
      renderHouseholds();

      root.querySelector('#st-create-household').addEventListener('click', () => {
        const nameInput = root.querySelector('#st-household-name');
        const name = nameInput.value.trim();
        if (!name) return;
        Store.createHousehold(name, userId);
        nameInput.value = '';
        renderHouseholds();
      });

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
          const photoDataUrl = reader.result;
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
