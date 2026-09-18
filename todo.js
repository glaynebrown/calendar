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

// The "Other" quick-add option: the same widget types Planner offers, minus
// "Today's Events" (that one only means something for a specific calendar
// day). Memories/Gratitude/Goals/Priorities aren't real new types at all --
// they're just a plain 'note' or 'checklist' with a preset starting title
// (and, for the two text ones, a placeholder), reusing all the same storage
// and rendering a bare Note/To-do List already has.
const NOTE_OTHER_TYPES = [
  { type: 'bullets', label: 'Bulleted List' },
  { type: 'drawing', label: 'Drawing/iPad' },
  { type: 'checklist', label: 'Goals' },
  { type: 'note', label: 'Gratitude', placeholder: 'What are you grateful for today?' },
  { type: 'habits', label: 'Habit Tracker' },
  { type: 'note', label: 'Memories', placeholder: 'What made today memorable?' },
  { type: 'moodboard', label: 'Mood Board' },
  { type: 'mood', label: 'Mood Tracker' },
  { type: 'photos', label: 'Photo Board' },
  { type: 'checklist', label: 'Priorities' },
];
const NOTE_TYPE_LABELS = { mood: 'Mood Tracker', habits: 'Habit Tracker', photos: 'Photo Board', moodboard: 'Mood Board', drawing: 'Drawing/iPad', note: 'Note', checklist: 'To-do List', bullets: 'Bulleted List' };

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
  // Id of an item newly inserted mid-list (see buildItemRow's Enter
  // handling) that should be sitting in edit mode. The in-place DOM
  // insertion already opens it immediately, but a live-sync echo re-render
  // landing before the user types anything would otherwise silently revert
  // it to a plain row -- render() re-opens it whenever this is still set,
  // and it's cleared the moment that item's own edit actually commits.
  pendingEditItemId: null,

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
    // Notes sync live now (see Store.startSync's notes listener) -- even a
    // change you just made yourself echoes back through that listener and
    // triggers a render a moment later, same as if someone else had edited
    // something. That used to be harmless when saves were purely local, but
    // now it can yank focus/the keyboard away mid-typing (e.g. right after
    // hitting Enter to add another to-do item). Capture whatever's focused
    // before rebuilding the list, then restore the equivalent element after,
    // so the flow of typing item after item survives a re-render triggered
    // out from under the user.
    const focusInfo = this._captureFocus();
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
      card.className = 'note-card sortable-item' + (note.width === 'half' ? ' width-half' : '');
      card.dataset.id = note.id;

      // Corner-drag resize, same two-axis gesture as Planner's widgets:
      // vertical sets a fixed height + overflow-y:auto on the content area
      // (contentBody, created below) so a long checklist/note gets an
      // actually taller box instead of leaving you stuck scrolling with no
      // way to see more at once; horizontal snaps between half/full width,
      // same as before. contentBody is assigned further down, but the
      // closures here only ever run in response to a later drag, by which
      // point it's already set.
      let contentBody;
      const resizeHandle = document.createElement('button');
      resizeHandle.type = 'button';
      resizeHandle.className = 'planner-widget-resize-handle note-resize-handle';
      resizeHandle.setAttribute('aria-label', note.width === 'half' ? 'Drag to make full width' : 'Drag to make half width');
      resizeHandle.innerHTML = icon('resize-grip');
      resizeHandle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const startHeight = contentBody.getBoundingClientRect().height;
        let previewWidth = note.width === 'half' ? 'half' : 'full';
        const move = ev => {
          const dy = ev.clientY - startY;
          const newHeight = Math.max(60, startHeight + dy);
          contentBody.style.height = `${newHeight}px`;
          contentBody.style.overflowY = 'auto';

          const dx = ev.clientX - startX;
          let next = previewWidth;
          if (dx > 24) next = 'full';
          else if (dx < -24) next = 'half';
          if (next !== previewWidth) {
            previewWidth = next;
            card.classList.toggle('width-half', previewWidth === 'half');
          }
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          const finalHeight = parseFloat(contentBody.style.height) || null;
          note.width = previewWidth;
          note.height = finalHeight;
          Store.updateNote(note.id, { width: previewWidth, height: finalHeight });
          resizeHandle.setAttribute('aria-label', previewWidth === 'half' ? 'Drag to make full width' : 'Drag to make half width');
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
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
      resizeHandle.style.color = textColor;
      resizeHandle.style.opacity = '0.55';
      card.appendChild(resizeHandle);

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
        else if (note.type === 'habits') (note.habitDefs || []).forEach(h => lines.push(`${(note.habitChecks || {})[h.id] ? '[x]' : '[ ]'} ${h.text}`));
        else if (note.type === 'mood') { if (note.moodValue) lines.push(note.moodValue.replace('mood-', '').replace('-', ' ')); }
        else if (note.type === 'bullets') (note.items || []).forEach(it => lines.push(`• ${it.text}`));
        else if (!['photos', 'moodboard', 'drawing'].includes(note.type)) (note.items || []).forEach(it => lines.push(`${it.checked ? '[x]' : '[ ]'} ${it.text}`));
        const text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
        copyBtn.innerHTML = icon('check');
        setTimeout(() => { copyBtn.innerHTML = icon('copy'); }, 1200);
      });
      inner.appendChild(header);

      // Everything below the header lives in here -- the resize handle's
      // vertical drag (see below) sets a fixed height + overflow-y:auto on
      // this one element, same as Planner's own widget body, so dragging
      // taller actually gives a note more room instead of leaving you stuck
      // scrolling its content with no way to see more at once.
      contentBody = document.createElement('div');
      contentBody.className = 'note-content-body';
      if (note.height) { contentBody.style.height = `${note.height}px`; contentBody.style.overflowY = 'auto'; }
      inner.appendChild(contentBody);

      if (note.type === 'note') {
        const textarea = document.createElement('textarea');
        textarea.className = 'note-text-area';
        textarea.placeholder = note.placeholder || 'Write something...';
        textarea.value = note.text || '';
        textarea.style.color = textColor;
        // Unconditional, not just when note.height is already set -- a
        // percentage height only ever resolves once contentBody actually
        // has a definite pixel height (i.e. after a resize drag), so this
        // is a no-op until then and takes effect the moment one happens,
        // without needing a re-render to pick it up.
        textarea.style.height = '100%';
        textarea.addEventListener('change', () => {
          Store.updateNote(note.id, { text: textarea.value });
        });
        contentBody.appendChild(textarea);
        card.appendChild(inner);
        list.appendChild(card);
        return;
      }

      if (['mood', 'habits', 'photos', 'moodboard', 'drawing'].includes(note.type)) {
        const widgetBody = document.createElement('div');
        widgetBody.className = 'note-widget-body';
        widgetBody.style.color = textColor;
        widgetBody.style.height = '100%'; // same no-op-until-resized reasoning as the note textarea above
        if (note.type === 'mood') Calendar.renderMoodWidget(widgetBody, Todo.noteContentApi(note, 'moodValue'));
        else if (note.type === 'habits') Calendar.renderHabitsWidget(widgetBody, Todo.noteHabitDefsApi(note), Todo.noteHabitChecksApi(note));
        else if (note.type === 'photos') Calendar.renderPhotosWidget(widgetBody, Todo.noteContentApi(note, 'photos'));
        else if (note.type === 'moodboard') Todo.renderMoodboardWidget(widgetBody, note);
        else if (note.type === 'drawing') Calendar.renderDrawingWidget(widgetBody, Todo.noteContentApi(note, 'strokes'), userId, null, null);
        contentBody.appendChild(widgetBody);
        card.appendChild(inner);
        list.appendChild(card);
        return;
      }

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'note-items';
      // A bulleted list is the same item shape/storage as a to-do list --
      // just a plain marker instead of a checkbox, and no "done" state to
      // toggle (matches the to-do list's own text size too, since it's
      // literally the same .note-item/.note-item-text rendering).
      const isBulletList = note.type === 'bullets';

      function buildItemRow(it) {
        const row = document.createElement('div');
        row.className = 'note-item sortable-item' + (!isBulletList && it.checked ? ' checked' : '');
        row.dataset.id = it.id;
        row.style.color = textColor;
        const marker = isBulletList
          ? `<span class="note-bullet" style="color:${textColor};opacity:0.55;">•</span>`
          : `<button type="button" class="note-check" style="background:none;border:none;padding:0;display:flex;color:inherit;" aria-label="Toggle done">${icon(it.checked ? 'check-square' : 'square')}</button>`;
        row.innerHTML = `<button type="button" class="drag-handle" style="color:${textColor};opacity:0.55;" aria-label="Reorder item">${icon('grip')}</button>
          ${marker}
          <span class="note-item-text">${escapeHTML(it.text)}</span>`;

        if (!isBulletList) {
          row.querySelector('.note-check').addEventListener('click', () => {
            it.checked = !it.checked;
            Store.updateNote(note.id, { items: note.items });
            Todo.render();
          });
        }

        const textEl = row.querySelector('.note-item-text');
        textEl.addEventListener('click', () => {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = it.text;
          // 16px, not the row's 13px -- iOS Safari auto-zooms the whole page
          // when a focused input is smaller than 16px. The "Add item" input
          // right below already does the same thing for the same reason.
          input.style.cssText = `color:${textColor};background:rgba(255,255,255,0.5);border:none;border-radius:4px;padding:2px 4px;font-size:16px;flex:1;min-width:0;`;
          // committed guards against double-firing: replacing/removing row
          // below (from Enter's own commit) blurs this input as a side
          // effect, which would otherwise fire the blur handler's commit a
          // second time on the same edit.
          let committed = false;
          // Enter here means "insert a new blank item right below this one
          // and start editing it" -- not just "save and stop", so you can
          // go back and slot a forgotten item into the middle of a list
          // without retyping everything after it. Plain tap-away (blur)
          // still just saves in place, same as before.
          //
          // This edits the DOM in place rather than calling Todo.render()
          // (same reasoning as the "Add item" row's own comment below): a
          // full re-render here is exactly the case _captureFocus/
          // _restoreFocus deliberately don't cover for item-text editing,
          // so a live-sync echo landing mid-edit would silently discard
          // whatever's in flight.
          function commit(insertNext) {
            if (committed) return;
            committed = true;
            if (Todo.pendingEditItemId === it.id) Todo.pendingEditItemId = null;
            const val = input.value.trim();
            const wasDeleted = !val;
            if (val) {
              it.text = val;
            } else {
              // Erasing an item's text entirely deletes it -- checking it
              // off is no longer the only way to remove one.
              note.items = (note.items || []).filter(i => i.id !== it.id);
            }
            // An empty item just deletes, full stop -- it never also spawns
            // a new blank one, since there's nothing there to "split".
            let newItem = null;
            if (insertNext && !wasDeleted) {
              newItem = { id: uid(), text: '', checked: false };
              const idx = (note.items || []).findIndex(i => i.id === it.id);
              if (idx >= 0) note.items.splice(idx + 1, 0, newItem);
              else note.items.push(newItem);
              Todo.pendingEditItemId = newItem.id;
            }
            Store.updateNote(note.id, { items: note.items });

            const insertAfterNode = row.nextSibling;
            if (wasDeleted) row.remove();
            else row.replaceWith(buildItemRow(it));

            if (newItem) {
              // Synchronous, not deferred -- unlike the "Add item" row's own
              // Return-key race (re-focusing the SAME input right as iOS
              // tries to dismiss its keyboard), this moves focus to a
              // DIFFERENT, brand-new input, which doesn't fight iOS the same
              // way. Deferring this via setTimeout was actually the bug:
              // it left a window where the click/focus could silently fail
              // to stick, requiring an extra manual tap into the new row.
              const newRow = buildItemRow(newItem);
              itemsContainer.insertBefore(newRow, insertAfterNode);
              newRow.querySelector('.note-item-text').click();
            }
          }
          input.addEventListener('blur', () => commit(false));
          input.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            // Same iOS default-action concern as the "Add item" row's own
            // Return handler -- stop it here too, before it can dismiss the
            // keyboard out from under the new item this is about to focus.
            e.preventDefault();
            commit(true);
          });
          textEl.replaceWith(input);
          input.focus();
          input.select();
        });

        return row;
      }

      const items = (note.items || []).filter(it => showChecked || !it.checked);
      items.forEach(it => {
        const row = buildItemRow(it);
        itemsContainer.appendChild(row);
        // Re-opens a just-inserted item's edit mode if a live-sync echo
        // re-render landed before the user got to type into it -- see
        // Todo.pendingEditItemId's own comment.
        if (Todo.pendingEditItemId === it.id) row.querySelector('.note-item-text').click();
      });
      contentBody.appendChild(itemsContainer);
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
      // keepFocus: false when committing because the user clicked/tapped
      // away (see the blur handler below) -- stealing focus back onto an
      // input they just left would fight the very thing they did, and on
      // iOS would likely pop the keyboard back open right after they
      // dismissed it.
      function commitAdd(keepFocus = true) {
        const text = addInput.value.trim();
        if (!text) return;
        note.items = note.items || [];
        const newItem = { id: uid(), text, checked: false };
        note.items.push(newItem);
        Store.updateNote(note.id, { items: note.items });
        itemsContainer.appendChild(buildItemRow(newItem));
        addInput.value = '';
        // As the note grows taller item by item, keep the input you're
        // actively typing into in view instead of letting the note just
        // keep growing downward out from under you.
        addInput.scrollIntoView({ block: 'nearest' });
        if (!keepFocus) return;
        // iOS Safari's on-screen keyboard treats Return on a plain text
        // input as "done" and starts dismissing it the instant the keydown
        // fires -- calling focus() synchronously, in the same handler,
        // loses that race and the keyboard closes anyway even though this
        // exact input is still focused in the DOM. Deferring to the next
        // tick, after iOS's own dismiss handling has already run, wins it.
        // The browser's own focus(scrollable-into-view) behavior can then
        // re-scroll things on its own terms right after, less precisely
        // than the explicit call above -- re-asserting it once more here,
        // after focus() has had its say, is what makes it stick.
        setTimeout(() => {
          addInput.focus();
          addInput.scrollIntoView({ block: 'nearest' });
        }, 0);
      }
      addInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        // Without this, iOS Safari's own default action for Return on a
        // plain text input -- dismissing the on-screen keyboard -- already
        // starts running before this handler even finishes, and the
        // deferred refocus below wins back DOM focus but not always the
        // keyboard itself. Once the keyboard actually closes, iOS resizes
        // the viewport back to full height, which is what was showing up
        // as the page scrolling back up on its own mid-list. Stopping the
        // default action here is what keeps the keyboard (and the scroll
        // position) from ever moving in the first place.
        e.preventDefault();
        commitAdd();
      });
      addInput.addEventListener('blur', () => {
        // Deferred, not immediate: a blur here doesn't necessarily mean the
        // user tapped away -- a live-sync re-render (see render()'s comment)
        // removes and rebuilds this exact input too, which fires blur on
        // the outgoing one an instant before the new one gets refocused.
        // Give that refocus a moment to happen, then only act if nothing in
        // this note's add row actually ended up focused.
        setTimeout(() => {
          const stillFocused = document.activeElement && document.activeElement.closest
            && document.activeElement.closest(`.note-card[data-id="${note.id}"] .note-add-item`);
          if (stillFocused) return;
          // Tapping away with something typed saves it, same as pressing
          // Enter would have -- previously this only ever discarded it.
          if (addInput.value.trim()) commitAdd(false);
          if (Todo.expandedAddFor === note.id) {
            Todo.expandedAddFor = null;
            Todo.render();
          }
        }, 50);
      });
      addBtn.addEventListener('click', () => {
        if (isAddExpanded) commitAdd();
        else expandAdd();
      });
      contentBody.appendChild(addRow);

      card.appendChild(inner);
      list.appendChild(card);
    });

    this._restoreFocus(focusInfo);
  },

  // Only the "add item" input, deliberately -- item-text editing commits on
  // blur (see buildItemRow), so trying to restore focus there too would
  // mean the outgoing input's blur-triggered commit firing its own nested
  // render() call while this one is still rebuilding the list. Narrower
  // but safe: covers exactly the flow this was written for (typing several
  // new items in a row without the list re-rendering out from under you).
  _captureFocus() {
    const active = document.activeElement;
    if (!active || active.tagName !== 'INPUT') return null;
    if (!active.closest('.note-add-item')) return null;
    const card = active.closest('.note-card');
    if (!card) return null;
    return { noteId: card.dataset.id, selStart: active.selectionStart, selEnd: active.selectionEnd };
  },
  _restoreFocus(info) {
    if (!info || this.expandedAddFor !== info.noteId) return;
    const card = document.querySelector(`.note-card[data-id="${info.noteId}"]`);
    const input = card && card.querySelector('.note-add-item input');
    if (!input) return;
    input.focus();
    if (info.selStart != null) input.setSelectionRange(info.selStart, info.selEnd);
  },

  openNoteModal(note, newType, presetMeta) {
    const userId = Store.getCurrentUserId();
    const isEdit = !!note;
    const noteType = isEdit ? (note.type || 'checklist') : (newType || 'checklist');
    const isOwner = !isEdit || note.ownerId === userId;
    const presets = NOTE_PALETTE.slice(0, 2);
    const presetIdx = note ? presets.findIndex(p => p.bg === note.bgColor) : 0;
    const isCustomColor = !!(note && note.bgColor && !note.bgPhoto && presetIdx < 0);
    const otherPeople = Store.getKnownPeople(userId).filter(p => p.id !== userId);
    const modalTitle = isEdit ? 'Edit note' : `New ${(presetMeta && presetMeta.label) || NOTE_TYPE_LABELS[noteType] || 'Note'}`;
    const defaultTitle = note ? note.title : (presetMeta ? presetMeta.label : '');
    const body = `
      <div class="modal-header"><h2>${modalTitle}</h2><button class="modal-close" id="nt-close">${icon('x')}</button></div>
      <div class="field"><input type="text" id="nt-title" value="${escapeAttr(defaultTitle || '')}" placeholder="Title"></div>
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
        reader.onload = () => {
          // Downscale before storing -- an uncompressed photo can easily
          // blow past this note's own 1MiB Firestore document limit, which
          // silently fails the save (see compressImageDataUrl's comment in
          // settings.js: the exact same failure mode already hit month
          // backgrounds before this got added there).
          compressImageDataUrl(reader.result, 1600, 0.75).then(dataUrl => {
            photoDataUrl = dataUrl;
            refreshGrid();
          }).catch(() => {
            alert("Couldn't process that image -- try a different one.");
          });
        };
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
          // Seeds each widget type's own fields fresh -- everything else
          // (background, sharing, width) works identically across every
          // type, only the "body" content differs. A Memories/Gratitude
          // note is a plain 'note' underneath, just with a starting
          // placeholder baked in (see NOTE_OTHER_TYPES).
          const extra = {};
          if (noteType === 'mood') extra.moodValue = null;
          else if (noteType === 'habits') { extra.habitDefs = []; extra.habitChecks = {}; extra.habitChecksDate = ''; }
          else if (noteType === 'photos') extra.photos = [];
          else if (noteType === 'moodboard') extra.stickers = [];
          else if (noteType === 'drawing') extra.strokes = [];
          else if (noteType === 'note' && presetMeta && presetMeta.placeholder) extra.placeholder = presetMeta.placeholder;
          Store.addNote({
            id: uid(), ownerId, title, bgColor, textColor, textColorManual, bgPhoto: photoDataUrl,
            type: noteType, items: [], text: '', width: 'full',
            order: Store.getNotes().filter(n => n.ownerId === ownerId).length, sharedWith, ...extra,
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
        <button type="button" class="btn" id="ntc-other" style="flex:1;">Other</button>
      </div>
    `, root => {
      root.querySelector('#ntc-close').addEventListener('click', closeModal);
      root.querySelector('#ntc-checklist').addEventListener('click', () => { closeModal(); Todo.openNoteModal(null, 'checklist'); });
      root.querySelector('#ntc-note').addEventListener('click', () => { closeModal(); Todo.openNoteModal(null, 'note'); });
      root.querySelector('#ntc-other').addEventListener('click', () => { closeModal(); Todo.openOtherTypeMenu(); });
    });
  },

  openOtherTypeMenu() {
    openModal(`
      <div class="modal-header"><h2>New</h2><button class="modal-close" id="nto-close">${icon('x')}</button></div>
      <div id="nto-list"></div>
    `, root => {
      root.querySelector('#nto-close').addEventListener('click', closeModal);
      const list = root.querySelector('#nto-list');
      NOTE_OTHER_TYPES.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-item';
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          closeModal();
          Todo.openNoteModal(null, opt.type, opt);
        });
        list.appendChild(btn);
      });
    });
  },

  // ---- content adapters: let mood/habits/photos/drawing's rendering code
  // (shared with Planner -- see calendar.js's plannerContentApi) read/write
  // straight from this note's own Firestore document instead of a specific
  // calendar day's local content, so a Notes-side widget is its own
  // permanent, synced thing rather than tied to today. ----
  noteContentApi(note, field) {
    return {
      get: () => note[field],
      set: value => { note[field] = value; Store.updateNote(note.id, { [field]: value }); },
    };
  },
  noteHabitDefsApi(note) {
    return {
      get: () => note.habitDefs || [],
      set: defs => { note.habitDefs = defs; Store.updateNote(note.id, { habitDefs: defs }); },
    };
  },
  // Habit names persist, but which ones are checked resets every day --
  // compared lazily against today's date rather than an explicit midnight
  // job, so it self-heals the moment the note is next opened on a new day.
  noteHabitChecksApi(note) {
    return {
      get: () => {
        const today = formatISO(new Date());
        return note.habitChecksDate === today ? (note.habitChecks || {}) : {};
      },
      set: checks => {
        const today = formatISO(new Date());
        note.habitChecks = checks;
        note.habitChecksDate = today;
        Store.updateNote(note.id, { habitChecks: checks, habitChecksDate: today });
      },
    };
  },
  // Mood Board: a bounded sticker canvas scoped to just this one note, reusing
  // Calendar's placement/drag/resize/rotate engine and sticker book verbatim
  // (see calendar.js's renderPlacedStickers/toggleStickerBook comment --
  // they already take their storage as plain get/save callbacks specifically
  // so Planner, Week view, and now Notes can all share them).
  renderMoodboardWidget(body, note) {
    body.classList.add('planner-moodboard-body');
    body.style.position = 'relative';
    const layer = document.createElement('div');
    layer.className = 'planner-stickers-layer';
    body.appendChild(layer);
    const getStickers = () => note.stickers || [];
    const saveStickers = stickers => { note.stickers = stickers; Store.updateNote(note.id, { stickers }); };
    Calendar.renderPlacedStickers(layer, getStickers, saveStickers);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'icon-btn note-sticker-add-btn';
    addBtn.setAttribute('aria-label', 'Add sticker');
    addBtn.innerHTML = icon('image');
    addBtn.addEventListener('click', () => Calendar.toggleStickerBook(body, Store.getCurrentUserId(), layer, getStickers, saveStickers));
    body.appendChild(addBtn);
  },
};

function escapeHTML(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
