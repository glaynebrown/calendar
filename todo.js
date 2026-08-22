const NOTE_PALETTE = [
  { bg: '#EEEDFE', text: '#26215C' },
  { bg: '#E1F5EE', text: '#04342C' },
  { bg: '#FAECE7', text: '#4A1B0C' },
  { bg: '#FBEAF0', text: '#4B1528' },
  { bg: '#F1EFE8', text: '#2C2C2A' },
  { bg: '#E6F1FB', text: '#042C53' },
  { bg: '#EAF3DE', text: '#173404' },
  { bg: '#FAEEDA', text: '#412402' },
];

function contrastTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#26231f' : '#ffffff';
}

/* Generic pointer-based drag-to-reorder. Attach once to a container; children
   marked .sortable-item (with a .drag-handle inside) become reorderable. */
function makeSortable(container, onReorder) {
  let dragEl = null;

  container.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest('.sortable-item');
    // Only claim items that belong directly to this container — otherwise a
    // nested sortable (e.g. items inside a note) also gets claimed by an
    // ancestor sortable (e.g. the notes list), which yanks it out of its note.
    if (!item || item.parentElement !== container) return;
    dragEl = item;
    dragEl.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });

  container.addEventListener('pointermove', e => {
    if (!dragEl) return;
    e.stopPropagation();
    const items = Array.from(container.querySelectorAll(':scope > .sortable-item'));
    const y = e.clientY;
    for (const item of items) {
      if (item === dragEl) continue;
      const rect = item.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dragIsAfter = !!(item.compareDocumentPosition(dragEl) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (y < mid && dragIsAfter) {
        container.insertBefore(dragEl, item);
        break;
      }
      if (y > mid && !dragIsAfter) {
        container.insertBefore(dragEl, item.nextSibling);
        break;
      }
    }
  });

  function endDrag(e) {
    if (!dragEl) return;
    e.stopPropagation();
    dragEl.classList.remove('dragging');
    const order = Array.from(container.querySelectorAll(':scope > .sortable-item')).map(el => el.dataset.id);
    dragEl = null;
    onReorder(order);
  }
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);
}

const Todo = {
  expandedAddFor: null, // id of the note whose "add item" input is currently open

  init() {
    document.getElementById('show-checked-btn').addEventListener('click', () => {
      const userId = Store.getCurrentUserId();
      Store.setShowChecked(userId, !Store.getShowChecked(userId));
      this.render();
    });

    const list = document.getElementById('notes-list');
    makeSortable(list, orderedIds => {
      // Shared lists from connections belong to their owner, not us — only
      // reorder the notes we actually own, in their new relative positions,
      // and leave everyone else's lists untouched.
      const userId = Store.getCurrentUserId();
      const byId = {};
      Store.getNotes().filter(n => n.ownerId === userId).forEach(n => { byId[n.id] = n; });
      const reordered = orderedIds.map(id => byId[id]).filter(Boolean);
      reordered.forEach((n, i) => { if (n.order !== i) Store.updateNote(n.id, { order: i }); });
      this.render();
    });

    this.render();
  },

  // Your own notes plus any lists connections have shared specifically with
  // you -- Store.getNotes() already returns exactly that (own + shared-with-
  // me, per its Firestore query), this just keeps your own lists grouped
  // first, each group in its own order.
  getVisibleNotes(userId) {
    const notes = Store.getNotes();
    const own = notes.filter(n => n.ownerId === userId).sort((a, b) => (a.order || 0) - (b.order || 0));
    const sharedFromOthers = notes.filter(n => n.ownerId !== userId).sort((a, b) => (a.order || 0) - (b.order || 0));
    return [...own, ...sharedFromOthers];
  },

  render() {
    const userId = Store.getCurrentUserId();
    if (!userId) return;
    const showChecked = Store.getShowChecked(userId);
    // Stays the same color either way -- state is communicated by the icon
    // itself (plain eye vs. slashed-through eye-off), not by darkening the
    // button when active.
    const showCheckedBtn = document.getElementById('show-checked-btn');
    const showCheckedIcon = showCheckedBtn.querySelector('[data-icon]');
    showCheckedIcon.setAttribute('data-icon', showChecked ? 'eye' : 'eye-off');
    showCheckedIcon.innerHTML = icon(showChecked ? 'eye' : 'eye-off');
    showCheckedBtn.setAttribute('aria-label', showChecked ? 'Hide checked items' : 'Show checked items');

    const notes = this.getVisibleNotes(userId);
    const list = document.getElementById('notes-list');
    list.innerHTML = '';

    if (!notes.length) {
      list.innerHTML = '<p class="note-empty">No sticky notes yet. Tap + to add one.</p>';
      return;
    }

    notes.forEach(note => {
      const card = document.createElement('div');
      card.className = 'note-card sortable-item';
      card.dataset.id = note.id;
      const isPhoto = !!note.bgPhoto;
      if (isPhoto) {
        card.style.backgroundImage = `linear-gradient(rgba(20,20,20,0.5), rgba(20,20,20,0.35)), url(${note.bgPhoto})`;
      } else {
        card.style.background = note.bgColor || NOTE_PALETTE[0].bg;
      }
      // note.textColor is always set at save time now (auto-contrast or a
      // manual pick -- see openNoteModal), photo backgrounds included, so
      // this fallback only ever matters for notes saved before this existed.
      const textColor = note.textColor || (isPhoto ? '#ffffff' : NOTE_PALETTE[0].text);

      const inner = document.createElement('div');
      inner.className = 'note-card-overlay';

      const isOwnNote = note.ownerId === userId;
      const ownerName = !isOwnNote ? ((Store.getPerson(note.ownerId) || {}).name || '') : '';
      const isSharedOut = isOwnNote && (note.sharedWith || []).length > 0;
      const tag = !isOwnNote
        ? `<span class="note-owner-tag" style="color:${textColor}">Shared by ${escapeHTML(ownerName)}</span>`
        : (isSharedOut ? `<span class="note-owner-tag" style="color:${textColor}">${icon('users')} Shared</span>` : '');

      const header = document.createElement('div');
      header.className = 'note-header';
      header.innerHTML = `<button type="button" class="drag-handle" style="color:${textColor};opacity:0.55;" aria-label="Reorder note">${icon('grip')}</button>
        <div class="note-title-group">
          <span class="note-title" style="color:${textColor}">${escapeHTML(note.title || 'Untitled')}</span>
          ${tag}
        </div>
        <button type="button" class="note-menu-btn note-copy-btn" style="color:${textColor};opacity:0.55;" aria-label="Copy list as text">${icon('copy')}</button>
        <button class="note-menu-btn" style="color:${textColor};opacity:0.55;" aria-label="Note options">${icon('dots')}</button>`;
      header.querySelector('.note-menu-btn:not(.note-copy-btn)').addEventListener('click', () => Todo.openNoteModal(note));
      const copyBtn = header.querySelector('.note-copy-btn');
      copyBtn.addEventListener('click', () => {
        const lines = [note.title || 'Untitled'];
        if (note.type === 'note') lines.push(note.text || '');
        else (note.items || []).forEach(it => lines.push(`${it.checked ? '[x]' : '[ ]'} ${it.text}`));
        const text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
        copyBtn.innerHTML = icon('check');
        setTimeout(() => { copyBtn.innerHTML = icon('copy'); }, 1200);
      });
      inner.appendChild(header);

      if (note.type === 'note') {
        const textarea = document.createElement('textarea');
        textarea.className = 'note-text-area';
        textarea.placeholder = 'Write something...';
        textarea.value = note.text || '';
        textarea.style.color = textColor;
        textarea.addEventListener('change', () => {
          Store.updateNote(note.id, { text: textarea.value });
        });
        inner.appendChild(textarea);
        card.appendChild(inner);
        list.appendChild(card);
        return;
      }

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'note-items';

      function buildItemRow(it) {
        const row = document.createElement('div');
        row.className = 'note-item sortable-item' + (it.checked ? ' checked' : '');
        row.dataset.id = it.id;
        row.style.color = textColor;
        row.innerHTML = `<button type="button" class="drag-handle" style="color:${textColor};opacity:0.55;" aria-label="Reorder item">${icon('grip')}</button>
          <button type="button" class="note-check" style="background:none;border:none;padding:0;display:flex;color:inherit;" aria-label="Toggle done">${icon(it.checked ? 'check-square' : 'square')}</button>
          <span class="note-item-text">${escapeHTML(it.text)}</span>`;

        row.querySelector('.note-check').addEventListener('click', () => {
          it.checked = !it.checked;
          Store.updateNote(note.id, { items: note.items });
          Todo.render();
        });

        const textEl = row.querySelector('.note-item-text');
        textEl.addEventListener('click', () => {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = it.text;
          input.style.cssText = `color:${textColor};background:rgba(255,255,255,0.5);border:none;border-radius:4px;padding:2px 4px;font-size:13px;flex:1;min-width:0;`;
          function commit() {
            const val = input.value.trim();
            if (val) it.text = val;
            Store.updateNote(note.id, { items: note.items });
            Todo.render();
          }
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') input.blur();
          });
          textEl.replaceWith(input);
          input.focus();
          input.select();
        });

        return row;
      }

      const items = (note.items || []).filter(it => showChecked || !it.checked);
      items.forEach(it => itemsContainer.appendChild(buildItemRow(it)));
      inner.appendChild(itemsContainer);
      makeSortable(itemsContainer, orderedIds => {
        const allItems = note.items || [];
        const byId = {};
        allItems.forEach(i => { byId[i.id] = i; });
        const movedIds = new Set(orderedIds);
        const untouched = allItems.filter(i => !movedIds.has(i.id));
        note.items = orderedIds.map(id => byId[id]).filter(Boolean).concat(untouched);
        Store.updateNote(note.id, { items: note.items });
        Todo.render();
      });

      const addRow = document.createElement('div');
      addRow.className = 'note-add-item';
      const isAddExpanded = Todo.expandedAddFor === note.id;
      addRow.innerHTML = `<button type="button" class="note-add-btn" style="color:${textColor};opacity:0.55;background:none;border:none;padding:0;display:flex;">${icon('plus')}</button><input type="text" placeholder="Add item" style="color:${textColor}"${isAddExpanded ? '' : ' class="hidden"'}>`;
      const addInput = addRow.querySelector('input');
      const addBtn = addRow.querySelector('.note-add-btn');

      function focusAddInput() {
        const refreshed = document.querySelector(`.note-card[data-id="${note.id}"] .note-add-item input`);
        if (refreshed) refreshed.focus();
      }
      function expandAdd() {
        Todo.expandedAddFor = note.id;
        Todo.render();
        focusAddInput();
      }
      // No full re-render here: replacing the whole card's DOM would drop
      // focus and dismiss the on-screen keyboard on mobile between items.
      // Instead just drop the new row in and clear the input in place, so
      // hitting return moves straight to a fresh line without interruption.
      function commitAdd() {
        const text = addInput.value.trim();
        if (!text) return;
        note.items = note.items || [];
        const newItem = { id: uid(), text, checked: false };
        note.items.push(newItem);
        Store.updateNote(note.id, { items: note.items });
        itemsContainer.appendChild(buildItemRow(newItem));
        addInput.value = '';
        addInput.focus();
      }
      addInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') commitAdd();
      });
      addInput.addEventListener('blur', () => {
        if (!addInput.value.trim() && Todo.expandedAddFor === note.id) {
          Todo.expandedAddFor = null;
          Todo.render();
        }
      });
      addBtn.addEventListener('click', () => {
        if (isAddExpanded) commitAdd();
        else expandAdd();
      });
      inner.appendChild(addRow);

      card.appendChild(inner);
      list.appendChild(card);
    });
  },

  openNoteModal(note, newType) {
    const userId = Store.getCurrentUserId();
    const isEdit = !!note;
    const noteType = isEdit ? (note.type || 'checklist') : (newType || 'checklist');
    const isOwner = !isEdit || note.ownerId === userId;
    const presets = NOTE_PALETTE.slice(0, 2);
    const presetIdx = note ? presets.findIndex(p => p.bg === note.bgColor) : 0;
    const isCustomColor = !!(note && note.bgColor && !note.bgPhoto && presetIdx < 0);
    const otherPeople = Store.getKnownPeople(userId).filter(p => p.id !== userId);
    const modalTitle = isEdit ? 'Edit note' : (noteType === 'note' ? 'New Note' : 'New To-do List');
    const body = `
      <div class="modal-header"><h2>${modalTitle}</h2><button class="modal-close" id="nt-close">${icon('x')}</button></div>
      <div class="field"><input type="text" id="nt-title" value="${note ? escapeAttr(note.title) : ''}" placeholder="Title"></div>
      <div class="field-row">
        <div class="field">
          <label>Background</label>
          <div class="bg-color-grid" id="nt-color-grid">
            ${presets.map((p, i) => `<button type="button" class="bg-color-swatch" data-i="${i}" style="background:${p.bg}"></button>`).join('')}
            <span class="color-box color-wheel-trigger" title="Pick any color">
              <input type="color" id="nt-color-custom" value="${isCustomColor ? note.bgColor : '#f4f3ef'}">
            </span>
            <button type="button" class="time-field-btn icon-only${note && note.bgPhoto ? ' active' : ''}" id="nt-photo-btn" aria-label="Choose photo background">${icon('image')}</button>
            <button type="button" class="icon-btn${note && note.bgPhoto ? '' : ' hidden'}" id="nt-photo-clear" aria-label="Remove photo">${icon('x')}</button>
          </div>
          <input type="file" id="nt-photo" accept="image/*" class="hidden">
        </div>
        <div class="field">
          <label>Text color</label>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="time-field-btn" id="nt-text-auto" style="width:auto; padding:9px 14px;">Auto</button>
            <span class="color-box color-wheel-trigger" title="Pick any color">
              <input type="color" id="nt-text-custom" value="${note && note.textColor ? note.textColor : '#26231f'}">
            </span>
          </div>
        </div>
      </div>
      ${isOwner && otherPeople.length ? `
      <div class="checkbox-row">
        <button type="button" class="link-btn" id="nt-share-toggle">Share with specific people</button>
      </div>
      <div id="nt-people-picker" class="people-picker${note && (note.sharedWith || []).length ? '' : ' hidden'}">
        ${otherPeople.map(p => `<label><input type="checkbox" value="${p.id}" ${note && (note.sharedWith || []).includes(p.id) ? 'checked' : ''}> ${escapeHTML(p.name)}</label>`).join('')}
      </div>` : ''}
      <div class="btn-row">
        ${isEdit && isOwner ? `<button class="btn btn-danger" id="nt-delete">Delete note</button>` : ''}
        <button class="btn btn-primary" id="nt-save">Save</button>
      </div>
    `;
    openModal(body, root => {
      root.querySelector('#nt-close').addEventListener('click', closeModal);
      let chosenColorIdx = presetIdx < 0 ? 0 : presetIdx;
      let customColor = isCustomColor ? note.bgColor : null;
      let photoDataUrl = note ? note.bgPhoto || null : null;
      // null = automatic (contrast-computed from the background, same as
      // before this existed); a hex string = the viewer's own explicit pick.
      let manualTextColor = note && note.textColorManual ? note.textColor : null;

      const grid = root.querySelector('#nt-color-grid');
      const wheelTrigger = grid.querySelector('.color-wheel-trigger');
      const colorCustomInput = root.querySelector('#nt-color-custom');
      const photoInput = root.querySelector('#nt-photo');
      const photoBtn = root.querySelector('#nt-photo-btn');
      const photoClearBtn = root.querySelector('#nt-photo-clear');
      const textAutoBtn = root.querySelector('#nt-text-auto');
      const textCustomInput = root.querySelector('#nt-text-custom');

      function autoTextColor() {
        return photoDataUrl ? '#ffffff' : (customColor ? contrastTextColor(customColor) : presets[chosenColorIdx].text);
      }
      function refreshTextColorUI() {
        // Same subdued "active" treatment as the photo button next to it
        // (accent-colored border/text, not a solid accent fill) -- Auto
        // isn't literally the app's accent color, so it shouldn't look like
        // a primary-action button.
        textAutoBtn.classList.toggle('active', !manualTextColor);
        textCustomInput.value = manualTextColor || autoTextColor();
      }
      function refreshGrid() {
        grid.querySelectorAll('.bg-color-swatch').forEach((btn, i) => {
          btn.classList.toggle('selected', i === chosenColorIdx && !photoDataUrl && !customColor);
        });
        wheelTrigger.classList.toggle('selected', !!customColor && !photoDataUrl);
        photoBtn.classList.toggle('active', !!photoDataUrl);
        photoClearBtn.classList.toggle('hidden', !photoDataUrl);
        refreshTextColorUI();
      }
      refreshGrid();
      grid.querySelectorAll('.bg-color-swatch').forEach((btn, i) => {
        btn.addEventListener('click', () => { chosenColorIdx = i; customColor = null; photoDataUrl = null; refreshGrid(); });
      });
      colorCustomInput.addEventListener('input', e => {
        customColor = e.target.value; photoDataUrl = null; refreshGrid();
      });

      photoBtn.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => { photoDataUrl = reader.result; refreshGrid(); };
        reader.readAsDataURL(file);
      });
      photoClearBtn.addEventListener('click', () => {
        photoDataUrl = null;
        photoInput.value = '';
        refreshGrid();
      });

      textAutoBtn.addEventListener('click', () => { manualTextColor = null; refreshTextColorUI(); });
      textCustomInput.addEventListener('input', e => { manualTextColor = e.target.value; refreshTextColorUI(); });

      const shareToggle = root.querySelector('#nt-share-toggle');
      const peoplePicker = root.querySelector('#nt-people-picker');
      if (shareToggle) shareToggle.addEventListener('click', () => peoplePicker.classList.toggle('hidden'));

      if (isEdit && isOwner) {
        root.querySelector('#nt-delete').addEventListener('click', () => {
          Store.deleteNote(note.id);
          closeModal();
          Todo.render();
        });
      }

      root.querySelector('#nt-save').addEventListener('click', () => {
        const title = root.querySelector('#nt-title').value.trim() || 'Untitled';
        const ownerId = isEdit ? note.ownerId : userId;
        const bgColor = photoDataUrl ? null : (customColor || presets[chosenColorIdx].bg);
        const textColor = manualTextColor || autoTextColor();
        const textColorManual = !!manualTextColor;
        const sharedWith = isOwner && peoplePicker
          ? Array.from(peoplePicker.querySelectorAll('input:checked')).map(i => i.value)
          : (note ? note.sharedWith || [] : []);
        if (isEdit) {
          Store.updateNote(note.id, { title, bgColor, textColor, textColorManual, bgPhoto: photoDataUrl, sharedWith });
        } else {
          Store.addNote({
            id: uid(), ownerId, title, bgColor, textColor, textColorManual, bgPhoto: photoDataUrl,
            type: noteType, items: [], text: '', order: Store.getNotes().filter(n => n.ownerId === ownerId).length, sharedWith,
          });
        }
        closeModal();
        Todo.render();
      });
    });
  },

  // The FAB on the To-do tab offers a choice before opening the real create
  // form, since a to-do list (checklist) and a note (free text) need
  // different content but share the same title/background/sharing setup.
  openCreateChoiceModal() {
    openModal(`
      <div class="modal-header"><h2>New</h2><button class="modal-close" id="ntc-close">${icon('x')}</button></div>
      <div class="btn-row">
        <button type="button" class="btn" id="ntc-checklist" style="flex:1;">To-do List</button>
        <button type="button" class="btn" id="ntc-note" style="flex:1;">Note</button>
      </div>
    `, root => {
      root.querySelector('#ntc-close').addEventListener('click', closeModal);
      root.querySelector('#ntc-checklist').addEventListener('click', () => { closeModal(); Todo.openNoteModal(null, 'checklist'); });
      root.querySelector('#ntc-note').addEventListener('click', () => { closeModal(); Todo.openNoteModal(null, 'note'); });
    });
  },
};

function escapeHTML(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
