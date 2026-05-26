const STORAGE_KEY = 'eed_matrix_v1';
const CTRL_COUNTER_KEY = 'eed_matrix_ctrl_counter';
const CTRL_PREFIX_KEY = 'eed_matrix_ctrl_prefix';
const DRAFT_KEY = 'eed_matrix_entry_draft';
const CERT_LAYOUT_KEY = 'eed_matrix_cert_layout';
const DAILY_BACKUP_KEY = 'eed_matrix_last_backup_prompt';
const DEFAULT_CTRL_PREFIX = 'CTRL NO. EED 26-27-';

/* ── DATA ── */
let data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let editId = null;
let deleteId = null;
let pendingImport = null;
let searchQ = '';
let filterOrg = '';
let filterStatus = '';
let sortBy = 'date-desc';
let dateFrom = '';
let dateTo = '';
let currentPage = 1;
let pageSize = 25;
let selectedIds = new Set();
let dateRangePicker = null;
let certPrefillRecord = null;

const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
const uid  = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt  = n  => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = n  => Number(n).toLocaleString('en-PH');
const fmtPct = n => Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';

function nextCtrlNo() {
  let counter = parseInt(localStorage.getItem(CTRL_COUNTER_KEY) || '0', 10) + 1;
  localStorage.setItem(CTRL_COUNTER_KEY, counter);
  return getCtrlPrefix() + String(counter).padStart(4, '0');
}

function getCtrlPrefix() {
  return localStorage.getItem(CTRL_PREFIX_KEY) || DEFAULT_CTRL_PREFIX;
}

function calcMarkupRate(cog, sp) {
  const c = Number(cog), s = Number(sp);
  if (!c || c === 0) return 0;
  return ((s - c) / c) * 100;
}

function fmtCompact(n) {
  return Number(n).toLocaleString('en-PH', { notation: 'compact', maximumFractionDigits: 2 });
}

function fmtCompactMoney(n) {
  return '₱' + Number(n).toLocaleString('en-PH', { notation: 'compact', maximumFractionDigits: 2 });
}

function hasNumber(value) { return /\d/.test(String(value)); }
function removeNumbers(value) { return String(value).replace(/[0-9]/g, ''); }
function validTextName(value) { return value && !hasNumber(value); }

/* ── ANIMATED COUNTER ── */
function animateValue(el, newVal, formatter, duration) {
  duration = duration || 420;
  const startVal = parseFloat(el.dataset.raw || '0') || 0;
  el.dataset.raw = newVal;
  if (startVal === newVal) { el.textContent = formatter(newVal); return; }
  const startTime = performance.now();
  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const cur = startVal + (newVal - startVal) * ease;
    el.textContent = formatter(cur);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = formatter(newVal);
  }
  requestAnimationFrame(step);
}

/* ── TOAST ── */
function toast(msg, err = false, action = null, duration = 3000) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  if (action) {
    t.classList.add('toast-with-action');
    const text = document.createElement('span');
    text.textContent = msg;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label || 'Undo';
    btn.addEventListener('click', () => {
      action.onClick?.();
      t.remove();
    });
    t.append(text, btn);
  } else {
    t.textContent = msg;
  }
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), duration);
}

/* ── INLINE VALIDATION ── */
function ensureErrorSpans() {
  document.querySelectorAll('.form-field input').forEach(input => {
    const field = input.closest('.form-field');
    if (!field || field.querySelector('.field-error')) return;
    const err = document.createElement('div');
    err.className = 'field-error';
    field.appendChild(err);
  });
}

function setFieldError(id, message) {
  const input = document.getElementById(id);
  if (!input) return;
  const field = input.closest('.form-field');
  const err = field ? field.querySelector('.field-error') : null;
  input.classList.toggle('input-error', Boolean(message));
  if (field) field.classList.toggle('has-error', Boolean(message));
  if (err) err.textContent = message || '';
}

function clearErrors(prefix) {
  ['org', 'eed', 'units', 'cog', 'sp', 'date', 'dateProposed', 'dateApproved', 'status'].forEach(k => setFieldError(prefix + k, ''));
}

function setupLiveValidation() {
  ['f-', 'e-'].forEach(prefix => {
    ['org', 'eed', 'units', 'cog', 'sp', 'date', 'dateProposed', 'dateApproved', 'status'].forEach(k => {
      const input = document.getElementById(prefix + k);
      if (!input) return;
      input.addEventListener('input', () => validateField(prefix, k));
      input.addEventListener('change', () => validateField(prefix, k));
    });
  });
}

function validateField(prefix, key) {
  const input = document.getElementById(prefix + key);
  if (!input) return true;
  const raw = input.value.trim();
  let message = '';
  const required = ['org', 'eed', 'units', 'cog', 'sp', 'date'].includes(key);

  if (!raw && required) message = 'This field is required.';
  else if ((key === 'org' || key === 'eed') && hasNumber(raw)) message = 'Letters only. Numbers are not allowed.';
  else if (['units', 'cog', 'sp'].includes(key)) {
    const val = Number(raw);
    if (Number.isNaN(val)) message = 'Enter a valid number.';
    else if (val < 0) message = 'Value cannot be negative.';
    else if (key === 'units' && !Number.isInteger(val)) message = 'Quantity must be a whole number.';
  }
  if (!message && key === 'dateApproved') {
    const proposed = document.getElementById(prefix + 'dateProposed')?.value || '';
    if (raw && proposed && raw < proposed) message = 'Approval date cannot be before proposed date.';
  }

  setFieldError(prefix + key, message);
  return !message;
}

/* ── TEXT-ONLY INPUTS ── */
function setupTextOnlyInputs() {
  ['f-org', 'f-eed', 'e-org', 'e-eed'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', () => {
      const cleaned = removeNumbers(input.value);
      if (input.value !== cleaned) {
        input.value = cleaned;
        toast('Numbers are not allowed in Org Name or EED Name.', true);
      }
    });
    input.addEventListener('paste', e => {
      e.preventDefault();
      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
      const cleanedText = removeNumbers(pastedText);
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = input.value.slice(0, start) + cleanedText + input.value.slice(end);
      input.setSelectionRange(start + cleanedText.length, start + cleanedText.length);
      if (pastedText !== cleanedText) toast('Numbers were removed from pasted text.', true);
    });
  });
}

/* ── FILTER & SORT ── */
function getVisible() {
  let rows = [...data];
  if (searchQ) {
    const q = searchQ.toLowerCase();
    rows = rows.filter(r => r.org.toLowerCase().includes(q) || r.eed.toLowerCase().includes(q));
  }
  if (filterOrg) rows = rows.filter(r => r.org === filterOrg);
  if (filterStatus) rows = rows.filter(r => (r.status || 'Proposed') === filterStatus);
  if (dateFrom) rows = rows.filter(r => r.date >= dateFrom);
  if (dateTo) rows = rows.filter(r => r.date <= dateTo);

  rows.sort((a, b) => {
    if (sortBy === 'date-desc') return b.date.localeCompare(a.date);
    if (sortBy === 'date-asc')  return a.date.localeCompare(b.date);
    if (sortBy === 'total-desc') return b.total - a.total;
    if (sortBy === 'total-asc')  return a.total - b.total;
    if (sortBy === 'org-asc')    return a.org.localeCompare(b.org);
    return 0;
  });
  return rows;
}

function resetPage() { currentPage = 1; }

/* ── RENDER ── */
function render() {
  const rows = getVisible();
  const tbody = document.getElementById('table-body');
  const empty = document.getElementById('empty-state');
  const rc = document.getElementById('row-count');

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  tbody.innerHTML = '';
  rc.textContent = data.length;
  empty.style.display = rows.length ? 'none' : 'block';
  document.getElementById('btn-clear-all').style.display = data.length ? '' : 'none';
  selectedIds = new Set([...selectedIds].filter(id => data.some(r => r.id === id)));

  pageRows.forEach(r => {
    const tr = document.createElement('tr');
    const markupRate = calcMarkupRate(r.cog, r.sp);
    tr.innerHTML = `
      <td class="select-col"><input type="checkbox" class="row-select" data-id="${r.id}" ${selectedIds.has(r.id) ? 'checked' : ''} aria-label="Select row"></td>
      <td class="ctrl-no">${esc(r.ctrlNo || '—')}</td>
      <td class="org">${orgChip(r.org)}</td>
      <td class="eed">${esc(r.eed)}</td>
      <td>${statusBadge(r.status || 'Proposed')}</td>
      <td class="num">${fmtN(r.units)}</td>
      <td class="num">${fmt(r.cog)}</td>
      <td class="num">${fmt(r.sp)}</td>
      <td class="num markup">${fmtPct(markupRate)}</td>
      <td class="total">${fmt(r.total)}</td>
      <td class="date-cell">${esc(r.date)}</td>
      <td class="date-cell">${esc(r.dateProposed || '—')}</td>
      <td class="date-cell">${esc(r.dateApproved || '—')}</td>
      <td>
        <div class="actions-cell">
          <button class="icon-btn cert-row-btn" data-id="${r.id}" title="Certificate Maker" style="color:var(--accent)">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><path d="M9 21l3-3 3 3M9 18v-3M15 18v-3"/></svg>
          </button>
          <button class="icon-btn edit-btn" data-id="${r.id}" title="Edit">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn del del-btn" data-id="${r.id}" title="Delete">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });

  updateSummary();
  updateOrgFilter();
  updatePagination(rows.length, start, pageRows.length, totalPages);
  updateBulkBar(pageRows);
}

function updatePagination(total, start, count, totalPages) {
  const from = total ? start + 1 : 0;
  const to = total ? start + count : 0;
  document.getElementById('page-info').textContent = `Showing ${fmtN(from)}–${fmtN(to)} of ${fmtN(total)}`;
  document.getElementById('page-number').textContent = `${currentPage} / ${totalPages}`;
  document.getElementById('page-prev').disabled = currentPage <= 1;
  document.getElementById('page-next').disabled = currentPage >= totalPages;
  document.getElementById('pagination-bar').style.display = total ? 'flex' : 'none';
}

function updateSummary() {
  const vis = getVisible();
  const units = vis.reduce((s, r) => s + Number(r.units), 0);
  const cogs = vis.reduce((s, r) => s + Number(r.cog) * Number(r.units), 0);
  const total = vis.reduce((s, r) => s + Number(r.total), 0);
  const revenue = vis.reduce((s, r) => s + Number(r.sp) * Number(r.units), 0);
  const margin = revenue > 0 ? (total / revenue * 100) : 0;

  const entriesEl = document.getElementById('s-entries');
  const unitsEl = document.getElementById('s-units');
  const cogsEl = document.getElementById('s-cogs');
  const totalEl = document.getElementById('s-total');
  const marginEl = document.getElementById('s-margin');

  animateValue(entriesEl, vis.length, v => fmtCompact(Math.round(v)));
  animateValue(unitsEl, units, v => fmtCompact(Math.round(v)));
  animateValue(cogsEl, cogs, v => fmtCompactMoney(v));
  animateValue(totalEl, total, v => fmtCompactMoney(v));
  animateValue(marginEl, margin, v => v.toFixed(2) + '%');

  entriesEl.title = fmtN(vis.length);
  unitsEl.title = fmtN(units);
  cogsEl.title = fmt(cogs);
  totalEl.title = fmt(total);
  marginEl.title = margin.toFixed(2) + '%';
}

function updateOrgFilter() {
  const orgs = [...new Set(data.map(r => r.org))].sort();
  const sel = document.getElementById('filter-org');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Orgs</option>';
  orgs.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── ORG CHIP HASH ── */
function orgHash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 12;
}
function orgChip(name) { return `<span class="org-chip chip-${orgHash(name)}">${esc(name)}</span>`; }

function statusBadge(status) {
  const normalized = String(status || 'Proposed');
  const cls = normalized.toLowerCase();
  return `<span class="status-badge status-${esc(cls)}">${esc(normalized)}</span>`;
}

function updateBulkBar(pageRows = []) {
  const bulkBar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  const selectAll = document.getElementById('select-all-rows');
  const visibleIds = pageRows.map(r => r.id);
  const selectedVisible = visibleIds.filter(id => selectedIds.has(id));
  if (bulkBar) bulkBar.classList.toggle('open', selectedIds.size > 0);
  if (countEl) countEl.textContent = fmtN(selectedIds.size);
  if (selectAll) {
    selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  }
}

function selectedRows() {
  return data.filter(r => selectedIds.has(r.id));
}

/* ── COLUMN VISIBILITY ── */

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setupDateRangeFilter() {
  const dateRangeInput = document.getElementById('date-range');
  const clearDatesBtn = document.getElementById('btn-clear-dates');
  const dateRangeWrap = dateRangeInput?.closest('.date-range-wrap');
  if (!dateRangeInput) return;

  if (typeof flatpickr !== 'undefined') {
    const picker = flatpickr(dateRangeInput, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'M d, Y',
      allowInput: false,
      onChange: selectedDates => {
        if (!selectedDates.length) return;
        dateFrom = formatDateForInput(selectedDates[0]);
        dateTo = formatDateForInput(selectedDates[selectedDates.length - 1]);
        resetPage();
        render();
      }
    });
    dateRangePicker = picker;

    dateRangeWrap?.addEventListener('click', () => picker.open());

    clearDatesBtn?.addEventListener('click', () => {
      dateFrom = '';
      dateTo = '';
      picker.clear();
      resetPage();
      render();
      toast('Date filter cleared.');
    });
  } else {
    dateRangeInput.type = 'date';
    dateRangeInput.removeAttribute('readonly');
    dateRangeInput.addEventListener('change', e => {
      dateFrom = e.target.value;
      dateTo = e.target.value;
      resetPage();
      render();
    });
    clearDatesBtn?.addEventListener('click', () => {
      dateFrom = '';
      dateTo = '';
      dateRangeInput.value = '';
      resetPage();
      render();
      toast('Date filter cleared.');
    });
  }
}

function setupEntryDatePickers() {
  if (typeof flatpickr === 'undefined') return;

  ['f-date', 'e-date', 'f-dateProposed', 'e-dateProposed', 'f-dateApproved', 'e-dateApproved'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;

    flatpickr(input, {
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      allowInput: false,
      clickOpens: true,
      disableMobile: true,
      onChange: () => {
        const prefix = id.startsWith('f-') ? 'f-' : 'e-';
        const key = id.replace(prefix, '');
        validateField(prefix, key);
      }
    });
  });
}

function setDateInputValue(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  if (input._flatpickr) input._flatpickr.setDate(value, true, 'Y-m-d');
  else input.value = value;
}

function setupEnterToSave() {
  const addFormInputs = document.querySelectorAll('#form-panel input');
  const editFormInputs = document.querySelectorAll('#edit-modal input');

  addFormInputs.forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      document.getElementById('btn-save')?.click();
    });
  });

  editFormInputs.forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      document.getElementById('edit-save')?.click();
    });
  });
}

function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  const savedTheme = localStorage.getItem('eed_matrix_theme');
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-mode');
    document.body.classList.add('dark-mode');
  }

  btn.addEventListener('click', () => {
    const isDark = !document.body.classList.contains('dark-mode');
    runThemeTransition(isDark, btn);
    localStorage.setItem('eed_matrix_theme', isDark ? 'dark' : 'light');
  });
}

function runThemeTransition(turningDark, triggerBtn) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Apply theme-transitioning class so all elements get CSS transitions
  document.body.classList.add('theme-transitioning');

  if (turningDark) {
    document.documentElement.classList.add('dark-mode');
    document.body.classList.add('dark-mode');
  } else {
    document.documentElement.classList.remove('dark-mode');
    document.body.classList.remove('dark-mode');
  }

  // Remove transitioning class after transitions complete
  const transitionEnd = setTimeout(() => {
    document.body.classList.remove('theme-transitioning');
  }, 480);

  if (reduceMotion) return;

  // ── Ripple overlay ──
  const oldWave = document.querySelector('.theme-wave');
  if (oldWave) { clearTimeout(oldWave._removeTimer); oldWave.remove(); }

  const wave = document.createElement('div');
  wave.className = `theme-wave ${turningDark ? 'theme-wave-in' : 'theme-wave-out'}`;
  document.body.appendChild(wave);
  wave._removeTimer = setTimeout(() => wave.remove(), 650);

  // ── Thumb pop animation ──
  const thumb = document.querySelector('.theme-toggle-thumb');
  if (thumb) {
    thumb.classList.remove('popping');
    // Force reflow to restart animation
    void thumb.offsetWidth;
    thumb.style.setProperty('--thumb-tx', turningDark ? '30px' : '0px');
    thumb.classList.add('popping');
    setTimeout(() => thumb.classList.remove('popping'), 460);
  }

  // ── Particle burst from toggle button ──
  if (triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const count = 8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 28 + Math.random() * 22;
      const bx = Math.cos(angle) * dist;
      const by = Math.sin(angle) * dist;
      const burst = document.createElement('div');
      burst.className = 'theme-burst';
      burst.style.left = cx + 'px';
      burst.style.top = cy + 'px';
      burst.style.setProperty('--bx', bx + 'px');
      burst.style.setProperty('--by', by + 'px');
      burst.style.animationDelay = (i * 18) + 'ms';
      burst.style.width = (4 + Math.random() * 4) + 'px';
      burst.style.height = burst.style.width;
      document.body.appendChild(burst);
      setTimeout(() => burst.remove(), 600 + i * 18);
    }
  }
}

/* ── ADD FORM ── */
const panel = document.getElementById('form-panel');

document.getElementById('btn-add').addEventListener('click', openAddForm);

function openAddForm() {
  editId = null;
  document.getElementById('form-panel-title').textContent = 'New Entry';
  clearForm('f-');
  clearErrors('f-');
  setDateInputValue('f-date', new Date().toISOString().slice(0, 10));
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft && Object.values(draft).some(Boolean)) applyFormSnapshot('f-', draft);
  } catch (_) {}
  updateCalcPreview('f-');
  panel.classList.add('open');
  document.getElementById('f-org').focus();
}

document.getElementById('btn-cancel').addEventListener('click', () => panel.classList.remove('open'));

document.getElementById('btn-save').addEventListener('click', () => {
  const entry = readForm('f-');
  if (!entry) return;
  data.unshift({ id: uid(), ctrlNo: nextCtrlNo(), ...entry });
  save();
  localStorage.removeItem(DRAFT_KEY);
  resetPage();
  render();
  panel.classList.remove('open');
  toast('Entry added successfully.');
});

/* ── EDIT / DELETE ── */
document.getElementById('table-body').addEventListener('click', e => {
  const certRowBtn = e.target.closest('.cert-row-btn');
  const editBtn = e.target.closest('.edit-btn');
  const delBtn = e.target.closest('.del-btn');

  if (certRowBtn) {
    const r = data.find(x => x.id === certRowBtn.dataset.id);
    if (!r) return;
    certPrefillRecord = r;
    document.getElementById('btn-cert').click();
    return;
  }

  if (editBtn) {
    const r = data.find(x => x.id === editBtn.dataset.id);
    if (!r) return;
    editId = r.id;
    clearErrors('e-');
    document.getElementById('e-org').value = r.org;
    document.getElementById('e-eed').value = r.eed;
    document.getElementById('e-units').value = r.units;
    document.getElementById('e-cog').value = r.cog;
    document.getElementById('e-sp').value = r.sp;
    setDateInputValue('e-date', r.date);
    setDateInputValue('e-dateProposed', r.dateProposed || '');
    setDateInputValue('e-dateApproved', r.dateApproved || '');
    document.getElementById('e-status').value = r.status || 'Proposed';
    updateCalcPreview('e-');
    document.getElementById('edit-modal').classList.add('open');
  }

  if (delBtn) {
    deleteId = delBtn.dataset.id;
    document.getElementById('del-modal').classList.add('open');
  }
});

document.getElementById('table-body').addEventListener('change', e => {
  const checkbox = e.target.closest('.row-select');
  if (!checkbox) return;
  if (checkbox.checked) selectedIds.add(checkbox.dataset.id);
  else selectedIds.delete(checkbox.dataset.id);
  render();
});

document.getElementById('select-all-rows')?.addEventListener('change', e => {
  const pageIds = Array.from(document.querySelectorAll('.row-select')).map(input => input.dataset.id);
  pageIds.forEach(id => e.target.checked ? selectedIds.add(id) : selectedIds.delete(id));
  render();
});

document.getElementById('bulk-delete')?.addEventListener('click', () => {
  const rows = selectedRows();
  if (!rows.length) return;
  if (!confirm(`Delete ${rows.length} selected record(s)? You can undo briefly after deletion.`)) return;
  const previous = [...data];
  data = data.filter(r => !selectedIds.has(r.id));
  selectedIds.clear();
  save();
  render();
  toast(`${rows.length} selected record(s) deleted.`, true, {
    label: 'Undo',
    onClick: () => {
      data = previous;
      save();
      render();
      toast('Bulk delete undone.');
    }
  }, 10000);
});

document.getElementById('bulk-status')?.addEventListener('change', e => {
  const status = e.target.value;
  if (!status || !selectedIds.size) return;
  data = data.map(r => selectedIds.has(r.id) ? { ...r, status } : r);
  save();
  render();
  e.target.value = '';
  toast(`Status updated for ${selectedIds.size} record(s).`);
});

document.getElementById('bulk-export')?.addEventListener('click', () => exportRowsToExcel(selectedRows(), 'eed-matrix-selected'));


document.getElementById('edit-cancel').addEventListener('click', () => document.getElementById('edit-modal').classList.remove('open'));
document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });

document.getElementById('edit-save').addEventListener('click', () => {
  const entry = readForm('e-');
  if (!entry) return;
  const idx = data.findIndex(x => x.id === editId);
  if (idx !== -1) {
    data[idx] = { id: editId, ctrlNo: data[idx].ctrlNo, ...entry };
    save();
    render();
  }
  document.getElementById('edit-modal').classList.remove('open');
  toast('Entry updated.');
});

document.getElementById('del-cancel').addEventListener('click', () => document.getElementById('del-modal').classList.remove('open'));
document.getElementById('del-modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
document.getElementById('del-confirm').addEventListener('click', () => {
  const deleted = data.find(r => r.id === deleteId);
  const index = data.findIndex(r => r.id === deleteId);
  data = data.filter(r => r.id !== deleteId);
  selectedIds.delete(deleteId);
  save();
  render();
  document.getElementById('del-modal').classList.remove('open');
  toast('Entry deleted.', true, {
    label: 'Undo',
    onClick: () => {
      if (!deleted || data.some(r => r.id === deleted.id)) return;
      data.splice(Math.max(0, index), 0, deleted);
      save();
      render();
      toast('Delete undone.');
    }
  }, 8000);
});

/* ── CLEAR ALL ── */
document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (confirm('Clear all entries? You can undo briefly after clearing.')) {
    const previous = [...data];
    data = [];
    selectedIds.clear();
    save();
    resetPage();
    render();
    toast('All entries cleared.', true, {
      label: 'Undo',
      onClick: () => {
        data = previous;
        save();
        resetPage();
        render();
        toast('Clear all undone.');
      }
    }, 10000);
  }
});

/* ── SEARCH / FILTER / SORT ── */
document.getElementById('search').addEventListener('input', e => { searchQ = e.target.value.trim(); resetPage(); render(); });
document.getElementById('filter-org').addEventListener('change', e => { filterOrg = e.target.value; resetPage(); render(); });
document.getElementById('filter-status').addEventListener('change', e => { filterStatus = e.target.value; resetPage(); render(); });
document.getElementById('sort-by').addEventListener('change', e => { sortBy = e.target.value; resetPage(); render(); });
document.getElementById('btn-reset-filters').addEventListener('click', () => {
  searchQ = '';
  filterOrg = '';
  filterStatus = '';
  sortBy = 'date-desc';
  dateFrom = '';
  dateTo = '';
  document.getElementById('search').value = '';
  document.getElementById('filter-org').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('sort-by').value = sortBy;
  dateRangePicker?.clear();
  const dateRangeInput = document.getElementById('date-range');
  if (dateRangeInput) dateRangeInput.value = '';
  resetPage();
  render();
  toast('Filters reset.');
});
// Date range filter is initialized in setupDateRangeFilter().

/* ── PAGINATION ── */
document.getElementById('page-size').addEventListener('change', e => {
  pageSize = Number(e.target.value) || 25;
  resetPage();
  render();
});
document.getElementById('page-prev').addEventListener('click', () => { if (currentPage > 1) { currentPage--; render(); } });
document.getElementById('page-next').addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(getVisible().length / pageSize));
  if (currentPage < totalPages) { currentPage++; render(); }
});

/* ── KEYBOARD SHORTCUTS ── */
document.addEventListener('keydown', e => {
  const active = document.activeElement;
  const typing = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    document.getElementById('search').focus();
    return;
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    panel.classList.remove('open');
    return;
  }
  if (!typing && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openAddForm();
  }
});

/* ── EXPORT EXCEL ── */
document.getElementById('btn-export').addEventListener('click', () => {
  exportRowsToExcel(getVisible(), 'eed-matrix');
});

function exportRowsToExcel(rows, baseName) {
  if (!rows.length) { toast('Nothing to export.', true); return; }

  const html = `
    <html><head><meta charset="UTF-8"><style>
      table{border-collapse:collapse;font-family:Arial,sans-serif}th{background:#f3f6fb;font-weight:bold;text-align:left}th,td{border:1px solid #d9dee8;padding:6px 10px;white-space:nowrap}.text{mso-number-format:"\\@"}.num{mso-number-format:"#,##0";text-align:right}.money{mso-number-format:'"₱"#,##0.00';text-align:right}.pct{mso-number-format:'0.00"%"';text-align:right}.date{mso-number-format:"yyyy\\-mm\\-dd"}col.ctrlcol{width:200px}col.org{width:180px}col.eed{width:180px}col.units{width:110px}col.moneycol{width:160px}col.datecol{width:130px}
    </style></head><body><table>
      <colgroup><col class="ctrlcol"><col class="org"><col class="eed"><col class="org"><col class="units"><col class="moneycol"><col class="moneycol"><col class="moneycol"><col class="moneycol"><col class="datecol"><col class="datecol"><col class="datecol"></colgroup>
      <thead><tr><th>Control No.</th><th>Org Name</th><th>EED Name</th><th>Status</th><th>Units</th><th>Cost of Goods</th><th>Selling Price</th><th>Markup Rate</th><th>Total</th><th>Date</th><th>Date Proposed</th><th>Date Approved</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="text">${excelEsc(r.ctrlNo || '')}</td><td class="text">${excelEsc(r.org)}</td><td class="text">${excelEsc(r.eed)}</td><td class="text">${excelEsc(r.status || 'Proposed')}</td><td class="num">${Number(r.units)}</td><td class="money">${Number(r.cog)}</td><td class="money">${Number(r.sp)}</td><td class="pct">${calcMarkupRate(r.cog, r.sp).toFixed(2)}</td><td class="money">${Number(r.total)}</td><td class="date">${excelEsc(r.date)}</td><td class="date">${excelEsc(r.dateProposed || '')}</td><td class="date">${excelEsc(r.dateApproved || '')}</td></tr>`).join('')}</tbody>
    </table></body></html>`;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = baseName + '-' + new Date().toISOString().slice(0, 10) + '.xls';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Excel file exported.');
}

function excelEsc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ── IMPORT CSV / EXCEL / BACKUP JSON WITH PREVIEW ── */
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const fileName = file.name.toLowerCase();
  const reader = new FileReader();

  reader.onload = event => {
    try {
      let result;

      if (fileName.endsWith('.json')) {
        result = parseJSONBackup(event.target.result);
      } else if (fileName.endsWith('.csv')) {
        result = parseCSVImport(event.target.result);
      } else if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
        result = parseExcelImport(event.target.result);
      } else {
        toast('Only CSV, JSON, XLS, and XLSX files are supported.', true);
        e.target.value = '';
        return;
      }

      showImportPreview(result, file.name);
    } catch (err) {
      toast('Import failed. Check your file format.', true);
      console.error(err);
    } finally {
      e.target.value = '';
    }
  };

  if (fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
});

function showImportPreview(result, fileName) {
  if (!result.records.length) {
    toast(result.message || 'No valid records found to import.', true);
    return;
  }
  const seen = new Set(data.map(recordKey));
  let duplicates = 0;
  result.records = result.records.filter(record => {
    const key = recordKey(record);
    if (seen.has(key)) {
      duplicates++;
      return false;
    }
    seen.add(key);
    return true;
  });
  result.duplicates = duplicates;
  if (!result.records.length) {
    toast('All import rows already exist in the matrix.', true);
    return;
  }
  pendingImport = result;
  document.getElementById('import-preview-copy').textContent = `File: ${fileName}. These records will be added to your current matrix only after you confirm.`;
  document.getElementById('import-preview-box').innerHTML = `
    <div class="import-stat"><span>Valid rows</span><strong>${fmtN(result.records.length)}</strong></div>
    <div class="import-stat"><span>Skipped rows</span><strong>${fmtN(result.skipped)}</strong></div>
    <div class="import-stat"><span>Duplicates</span><strong>${fmtN(result.duplicates || 0)}</strong></div>
    <div class="import-stat"><span>Type</span><strong>${esc(result.type)}</strong></div>`;
  document.getElementById('import-modal').classList.add('open');
}

function recordKey(r) {
  return [r.org, r.eed, r.units, r.cog, r.sp, r.date].map(v => String(v ?? '').trim().toLowerCase()).join('|');
}

document.getElementById('import-cancel').addEventListener('click', () => {
  pendingImport = null;
  document.getElementById('import-modal').classList.remove('open');
});

document.getElementById('import-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
});

document.getElementById('import-confirm').addEventListener('click', () => {
  if (!pendingImport) return;
  data = [...pendingImport.records, ...data];
  save();
  resetPage();
  render();
  toast(`${pendingImport.records.length} ${pendingImport.type} records imported.${pendingImport.skipped ? ` ${pendingImport.skipped} skipped.` : ''}${pendingImport.duplicates ? ` ${pendingImport.duplicates} duplicates ignored.` : ''}`);
  pendingImport = null;
  document.getElementById('import-modal').classList.remove('open');
});

function parseCSVImport(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return { type: 'CSV', records: [], skipped: 0 };
  const rows = lines.map(parseCSVLine);
  return parseImportRows(rows, false, 'CSV');
}

function parseExcelImport(arrayBuffer) {
  // This app exports .xls as an HTML table so it opens in Excel.
  // Import that same exported file by parsing the table directly first.
  const decodedText = decodeArrayBufferText(arrayBuffer);
  if (looksLikeHTMLTable(decodedText)) {
    const htmlResult = parseHTMLTableImport(decodedText);
    if (htmlResult.records.length) return htmlResult;
  }

  if (typeof XLSX === 'undefined') {
    return {
      type: 'Excel',
      records: [],
      skipped: 0,
      message: 'Excel importer is missing. Make sure js/vendor/xlsx.full.min.js exists and loads before app.js.'
    };
  }

  try {
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = sheetToRows(sheet);
    const result = rows.length < 2
      ? { type: 'Excel', records: [], skipped: 0 }
      : parseImportRows(rows, true, 'Excel');

    return result;
  } catch (err) {
    console.warn('Excel import failed. Trying HTML .xls fallback.', err);
    if (looksLikeHTMLTable(decodedText)) return parseHTMLTableImport(decodedText);
    return { type: 'Excel', records: [], skipped: 0, message: 'Could not read this Excel file. Try exporting again, or import the Backup JSON.' };
  }
}

function decodeArrayBufferText(arrayBuffer) {
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
  } catch (_) {
    return '';
  }
}

function looksLikeHTMLTable(text) {
  return /<table[\s>]/i.test(text || '') && /<tr[\s>]/i.test(text || '');
}

function parseHTMLTableImport(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return { type: 'Excel', records: [], skipped: 0, message: 'No table found in this .xls file.' };

  const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
    Array.from(tr.children).map(cell => htmlCellText(cell))
  );

  if (rows.length < 2) return { type: 'Excel', records: [], skipped: 0 };
  return parseImportRows(rows, false, 'Excel');
}

function htmlCellText(cell) {
  // Prefer textContent because exported app files store clean numbers/dates inside cells.
  return String(cell?.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildImportRecord(cols, fromExcel = false, indexes = DEFAULT_IMPORT_INDEXES) {
  const org = readImportText(cols, indexes.org);
  const eed = readImportText(cols, indexes.eed);
  const units = parseNumberValue(cols[indexes.units]);
  const cog = parseMoneyValue(cols[indexes.cog]);
  const sp = parseMoneyValue(cols[indexes.sp]);
  const totalFromFile = indexes.total === -1 ? NaN : parseMoneyValue(cols[indexes.total]);
  const dateValue = cols[indexes.date];
  const date = fromExcel ? cleanExcelDate(dateValue) : cleanDateValue((dateValue || '').toString().trim());

  if (!validTextName(org)) return { error: 'Missing Org Name' };
  if (!validTextName(eed)) return { error: 'Missing EED Name' };
  if (isNaN(units)) return { error: 'Missing Units/Expected Quantity' };
  if (isNaN(cog)) return { error: 'Missing Cost of Goods' };
  if (isNaN(sp)) return { error: 'Missing Selling Price' };
  if (!date) return { error: 'Missing Date' };

  return {
    id: uid(),
    ctrlNo: (cols[7] ? String(cols[7]).trim() : '') || nextCtrlNo(),
    org,
    eed,
    units,
    cog,
    sp,
    total: isNaN(totalFromFile) ? (sp - cog) * units : totalFromFile,
    date,
    dateProposed: cols[8] ? (fromExcel ? cleanExcelDate(cols[8]) : cleanDateValue(String(cols[8]).trim())) : '',
    dateApproved: cols[9] ? (fromExcel ? cleanExcelDate(cols[9]) : cleanDateValue(String(cols[9]).trim())) : '',
    status: ['Proposed', 'Approved', 'Ongoing', 'Completed', 'Cancelled'].includes(String(cols[10] || '').trim())
      ? String(cols[10]).trim()
      : 'Proposed'
  };
}

function readImportText(cols, index) {
  if (index === -1) return '';
  return removeNumbers(String(cols[index] ?? '').replace(/#+/g, '').trim());
}

const DEFAULT_IMPORT_INDEXES = { org: 0, eed: 1, units: 2, cog: 3, sp: 4, total: 5, date: 6 };
const IMPORT_INDEX_CANDIDATES = buildImportIndexCandidates();

function buildImportIndexCandidates() {
  const layouts = [
    DEFAULT_IMPORT_INDEXES,
    { org: 0, eed: 1, units: 2, cog: 3, sp: 4, total: -1, date: 5 },
    { org: 0, eed: 1, units: 4, cog: 2, sp: 3, total: 5, date: 6 },
    { org: 0, eed: 1, units: 4, cog: 2, sp: 3, total: -1, date: 5 }
  ];
  const candidates = [];
  for (let offset = 0; offset <= 4; offset++) {
    layouts.forEach(layout => candidates.push(shiftImportIndexes(layout, offset)));
  }
  return candidates;
}

function shiftImportIndexes(indexes, offset) {
  return Object.fromEntries(
    Object.entries(indexes).map(([key, value]) => [key, value === -1 ? -1 : value + offset])
  );
}

function parseImportRows(rows, fromExcel, type) {
  const usefulRows = rows.filter(row => row.some(cell => String(cell ?? '').trim() !== ''));
  if (usefulRows.length < 2) return { type, records: [], skipped: 0 };

  const headerInfo = findImportHeader(usefulRows);
  const startIndex = headerInfo ? headerInfo.index + 1 : 0;
  const indexes = headerInfo ? headerInfo.indexes : null;
  const candidates = indexes ? [indexes, ...IMPORT_INDEX_CANDIDATES] : IMPORT_INDEX_CANDIDATES;
  const records = [];
  const skipReasons = {};
  let skipped = 0;

  for (let i = startIndex; i < usefulRows.length; i++) {
    const record = buildBestImportRecord(usefulRows[i], fromExcel, candidates);
    if (record.error) {
      skipped++;
      skipReasons[record.error] = (skipReasons[record.error] || 0) + 1;
      continue;
    }
    records.push(record);
  }

  return {
    type,
    records,
    skipped,
    message: buildImportErrorMessage(skipReasons)
  };
}

function sheetToRows(sheet) {
  if (!sheet || !sheet['!ref'] || typeof XLSX === 'undefined') return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const rows = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
    const row = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex++) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[address];
      row.push(cell ? cell.v : '');
    }
    rows.push(row);
  }
  return rows;
}

function buildBestImportRecord(row, fromExcel, candidates) {
  const normalizedRow = normalizeImportRow(row);
  const errors = {};
  const directRecord = buildImportRecord(normalizedRow, fromExcel, DEFAULT_IMPORT_INDEXES);
  if (!directRecord.error) return directRecord;
  errors[directRecord.error] = (errors[directRecord.error] || 0) + 1;

  for (const indexes of candidates) {
    const record = buildImportRecord(normalizedRow, fromExcel, indexes);
    if (!record.error) return record;
    errors[record.error] = (errors[record.error] || 0) + 1;
  }
  return { error: chooseImportError(errors) };
}

function normalizeImportRow(row) {
  const normalized = [...row];
  const compact = row.filter(cell => String(cell ?? '').trim() !== '');
  const defaultLooksValid =
    validTextName(readImportText(normalized, 0)) &&
    validTextName(readImportText(normalized, 1)) &&
    !isNaN(parseNumberValue(normalized[2])) &&
    !isNaN(parseMoneyValue(normalized[3])) &&
    !isNaN(parseMoneyValue(normalized[4])) &&
    cleanDateValue(normalized[6] ?? '');

  if (defaultLooksValid) return normalized;

  const compactLooksValid =
    compact.length >= 6 &&
    validTextName(readImportText(compact, 0)) &&
    validTextName(readImportText(compact, 1)) &&
    !isNaN(parseNumberValue(compact[2])) &&
    !isNaN(parseMoneyValue(compact[3])) &&
    !isNaN(parseMoneyValue(compact[4]));

  return compactLooksValid ? compact : normalized;
}

function chooseImportError(errors) {
  const priority = [
    'Missing Org Name',
    'Missing EED Name',
    'Missing Units/Expected Quantity',
    'Missing Cost of Goods',
    'Missing Selling Price',
    'Missing Date'
  ];
  return priority.find(reason => errors[reason]) || Object.keys(errors)[0] || 'Unrecognized row layout';
}

function findImportHeader(rows) {
  const maxScan = Math.min(rows.length, 10);
  for (let i = 0; i < maxScan; i++) {
    const indexes = resolveImportIndexes(rows[i], true);
    const requiredIndexes = ['org', 'eed', 'units', 'cog', 'sp', 'date'].map(key => indexes[key]);
    const hasCompleteHeader = requiredIndexes.every(index => index !== -1) && new Set(requiredIndexes).size === requiredIndexes.length;
    if (hasCompleteHeader) return { index: i, indexes };
  }
  return null;
}

function buildImportErrorMessage(skipReasons) {
  const reasons = Object.entries(skipReasons).sort((a, b) => b[1] - a[1]);
  if (!reasons.length) return 'No valid records found to import.';
  const [reason, count] = reasons[0];
  return `No valid records found. Most skipped rows: ${reason} (${count}).`;
}

function resolveImportIndexes(headerRow, strict = false) {
  const headers = headerRow.map(normalizeImportHeader);
  const find = names => {
    for (const name of names) {
      const index = headers.findIndex(header => header === name || header.includes(name));
      if (index !== -1) return index;
    }
    return -1;
  };

  const indexes = {
    org: find(['orgname', 'organizationname', 'organization', 'org', 'club', 'department']),
    eed: find(['eedname', 'eed', 'expensename', 'itemname', 'item', 'particular', 'description']),
    units: find(['expectedquantity', 'quantity', 'units', 'unit', 'qty', 'count']),
    cog: find(['costofgoods', 'costofgood', 'cost', 'cog', 'cogs', 'capital']),
    sp: find(['sellingprice', 'saleprice', 'price', 'sp', 'sales']),
    total: find(['netproceeds', 'netproceed', 'proceeds', 'total', 'amount']),
    date: find(['date', 'transactiondate', 'createddate'])
  };

  const requiredKeys = ['org', 'eed', 'units', 'cog', 'sp', 'date'];
  const requiredIndexes = requiredKeys.map(key => indexes[key]);
  const hasRequiredHeaders = requiredIndexes.every(index => index !== -1) && new Set(requiredIndexes).size === requiredIndexes.length;
  if (hasRequiredHeaders) return indexes;
  if (strict) return indexes;

  const fallback = { ...DEFAULT_IMPORT_INDEXES };
  if (headerRow.length === 6) {
    fallback.total = -1;
    fallback.date = 5;
  }
  return fallback;
}

function normalizeImportHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseJSONBackup(jsonText) {
  const backup = JSON.parse(jsonText);
  const source = Array.isArray(backup) ? backup : backup.records;
  if (!Array.isArray(source)) return { type: 'Backup', records: [], skipped: 0 };
  let skipped = 0;
  const skipReasons = {};
  const records = source.map(r => {
    const record = buildImportRecord(objectToImportRow(r), false);
    if (record.error) {
      skipped++;
      skipReasons[record.error] = (skipReasons[record.error] || 0) + 1;
      return null;
    }
    return record;
  }).filter(Boolean);
  return { type: 'Backup', records, skipped, message: buildImportErrorMessage(skipReasons) };
}

function objectToImportRow(record) {
  return [
    getImportObjectValue(record, ['org', 'orgName', 'Org Name', 'organization', 'Organization']),
    getImportObjectValue(record, ['eed', 'eedName', 'EED Name', 'expense', 'item', 'description']),
    getImportObjectValue(record, ['units', 'Expected Quantity', 'quantity', 'qty']),
    getImportObjectValue(record, ['cog', 'Cost of Goods', 'cost', 'cogs']),
    getImportObjectValue(record, ['sp', 'Selling Price', 'price', 'sellingPrice']),
    getImportObjectValue(record, ['total', 'Net Proceeds', 'netProceeds', 'proceeds']),
    getImportObjectValue(record, ['date', 'Date', 'transactionDate']),
    getImportObjectValue(record, ['ctrlNo', 'Control No.', 'controlNo', 'ctrl']),
    getImportObjectValue(record, ['dateProposed', 'Date Proposed', 'proposed']),
    getImportObjectValue(record, ['dateApproved', 'Date Approved', 'approved']),
    getImportObjectValue(record, ['status', 'Status'])
  ];
}

function getImportObjectValue(record, keys) {
  for (const key of keys) {
    if (record && Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return '';
}

function cleanExcelDate(value) {
  if (!value) return '';

  if (value instanceof Date && !isNaN(value.getTime())) return formatDateForInput(value);

  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + value);
    return excelEpoch.toISOString().slice(0, 10);
  }

  const dateValue = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;

  const parsed = new Date(dateValue);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return cleanDateValue(dateValue);
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && insideQuotes && next === '"') { current += '"'; i++; }
    else if (char === '"') insideQuotes = !insideQuotes;
    else if (char === ',' && !insideQuotes) { result.push(current); current = ''; }
    else current += char;
  }
  result.push(current);
  return result.map(v => v.replace(/^"|"$/g, '').trim());
}
function cleanDateValue(value) {
  const dateValue = String(value).replace(/^="?/, '').replace(/"?$/, '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
  const parsed = new Date(dateValue);
  if (!isNaN(parsed.getTime())) return formatDateForInput(parsed);
  return dateValue;
}
function parseNumberValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  return cleaned ? Number(cleaned) : NaN;
}
function parseMoneyValue(value) {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  if (/^#+$/.test(raw)) return 0;
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (!cleaned) return NaN;
  const parsed = Number(cleaned);
  return negative ? -parsed : parsed;
}

/* ── BACKUP JSON EXPORT ── */
document.getElementById('btn-backup').addEventListener('click', () => {
  if (!data.length) { toast('No records to backup.', true); return; }
  const backup = { app: 'EED Matrix', version: 1, exportedAt: new Date().toISOString(), records: data };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'eed-matrix-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup JSON exported.');
});

document.getElementById('btn-report')?.addEventListener('click', () => {
  const rows = getVisible();
  if (!rows.length) { toast('Nothing to report.', true); return; }
  const units = rows.reduce((s, r) => s + Number(r.units || 0), 0);
  const cogs = rows.reduce((s, r) => s + Number(r.cog || 0) * Number(r.units || 0), 0);
  const proceeds = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const html = `<!doctype html><html><head><meta charset="UTF-8"><title>EED Matrix Report</title>
    <style>body{font-family:Arial,sans-serif;color:#111827;padding:28px}h1{margin:0 0 6px;font-size:22px}.meta{color:#64748b;margin-bottom:18px}.summary{display:flex;gap:10px;margin-bottom:18px}.summary div{border:1px solid #d9dee8;padding:10px 12px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #d9dee8;padding:7px 8px;text-align:left}th{background:#f3f6fb}.num{text-align:right}@media print{body{padding:0}.no-print{display:none}}</style>
    </head><body><button class="no-print" onclick="print()">Print</button><h1>EED Matrix Report</h1>
    <div class="meta">Generated ${new Date().toLocaleString('en-PH')}</div>
    <div class="summary"><div><strong>${fmtN(rows.length)}</strong><br>Records</div><div><strong>${fmtN(units)}</strong><br>Units</div><div><strong>${fmt(cogs)}</strong><br>Total COGS</div><div><strong>${fmt(proceeds)}</strong><br>Net Proceeds</div></div>
    <table><thead><tr><th>Control No.</th><th>Org</th><th>EED</th><th>Status</th><th class="num">Units</th><th class="num">COG</th><th class="num">Selling Price</th><th class="num">Net</th><th>Date</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.ctrlNo || '')}</td><td>${esc(r.org)}</td><td>${esc(r.eed)}</td><td>${esc(r.status || 'Proposed')}</td><td class="num">${fmtN(r.units)}</td><td class="num">${fmt(r.cog)}</td><td class="num">${fmt(r.sp)}</td><td class="num">${fmt(r.total)}</td><td>${esc(r.date)}</td></tr>`).join('')}</tbody></table></body></html>`;
  const win = window.open('', '_blank');
  if (!win) { toast('Popup blocked. Allow popups to print the report.', true); return; }
  win.document.write(html);
  win.document.close();
});

document.getElementById('btn-settings')?.addEventListener('click', () => {
  document.getElementById('setting-ctrl-prefix').value = getCtrlPrefix();
  document.getElementById('setting-ctrl-next').value = parseInt(localStorage.getItem(CTRL_COUNTER_KEY) || '0', 10) + 1;
  document.getElementById('settings-modal').classList.add('open');
});
document.getElementById('settings-cancel')?.addEventListener('click', () => document.getElementById('settings-modal').classList.remove('open'));
document.getElementById('settings-modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });
document.getElementById('settings-save')?.addEventListener('click', () => {
  const prefix = document.getElementById('setting-ctrl-prefix').value.trim() || DEFAULT_CTRL_PREFIX;
  const next = Math.max(1, Number(document.getElementById('setting-ctrl-next').value) || 1);
  localStorage.setItem(CTRL_PREFIX_KEY, prefix);
  localStorage.setItem(CTRL_COUNTER_KEY, String(next - 1));
  document.getElementById('settings-modal').classList.remove('open');
  toast('Settings saved.');
});

/* ── AUTO BACKUP TO LOCAL STORAGE EVERY 30 SECONDS ── */
setInterval(() => {
  localStorage.setItem('eed_matrix_auto_backup', JSON.stringify({ app: 'EED Matrix', version: 1, savedAt: new Date().toISOString(), records: data }));
}, 30000);

function showDailyBackupReminder() {
  if (!data.length) return;
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(DAILY_BACKUP_KEY) === today) return;
  localStorage.setItem(DAILY_BACKUP_KEY, today);
  toast('Daily reminder: export a backup JSON for safekeeping.', false, {
    label: 'Backup',
    onClick: () => document.getElementById('btn-backup')?.click()
  }, 10000);
}

/* ── HELPERS ── */
function clearForm(p) {
  ['org', 'eed', 'units', 'cog', 'sp', 'date', 'dateProposed', 'dateApproved', 'status'].forEach(k => {
    const el = document.getElementById(p + k);
    if (el) el.value = k === 'status' ? 'Proposed' : '';
  });
}

function readForm(p) {
  clearErrors(p);
  const keys = ['org', 'eed', 'units', 'cog', 'sp', 'date', 'dateApproved'];
  const valid = keys.map(k => validateField(p, k)).every(Boolean);
  if (!valid) { toast('Please fix the highlighted fields.', true); return null; }

  const org = document.getElementById(p + 'org').value.trim();
  const eed = document.getElementById(p + 'eed').value.trim();
  const units = Number(document.getElementById(p + 'units').value);
  const cog = Number(document.getElementById(p + 'cog').value);
  const sp = Number(document.getElementById(p + 'sp').value);
  const date = document.getElementById(p + 'date').value;
  const dateProposed = (document.getElementById(p + 'dateProposed')?.value) || '';
  const dateApproved = (document.getElementById(p + 'dateApproved')?.value) || '';
  const status = (document.getElementById(p + 'status')?.value) || 'Proposed';
  const total = (sp * units) - (cog * units);
  return { org, eed, units, cog, sp, date, dateProposed, dateApproved, status, total };
}

function formSnapshot(p) {
  return {
    org: document.getElementById(p + 'org')?.value || '',
    eed: document.getElementById(p + 'eed')?.value || '',
    units: document.getElementById(p + 'units')?.value || '',
    cog: document.getElementById(p + 'cog')?.value || '',
    sp: document.getElementById(p + 'sp')?.value || '',
    date: document.getElementById(p + 'date')?.value || '',
    dateProposed: document.getElementById(p + 'dateProposed')?.value || '',
    dateApproved: document.getElementById(p + 'dateApproved')?.value || '',
    status: document.getElementById(p + 'status')?.value || 'Proposed'
  };
}

function applyFormSnapshot(p, snapshot) {
  if (!snapshot) return;
  ['org', 'eed', 'units', 'cog', 'sp', 'dateProposed', 'dateApproved', 'status'].forEach(k => {
    const el = document.getElementById(p + k);
    if (el && snapshot[k] != null) el.value = snapshot[k];
  });
  if (snapshot.date) setDateInputValue(p + 'date', snapshot.date);
  updateCalcPreview(p);
}

function setupDraftAndCalculations() {
  ['f-', 'e-'].forEach(prefix => {
    ['org', 'eed', 'units', 'cog', 'sp', 'date', 'dateProposed', 'dateApproved', 'status'].forEach(k => {
      const el = document.getElementById(prefix + k);
      if (!el) return;
      const handler = () => {
        updateCalcPreview(prefix);
        if (prefix === 'f-' && panel.classList.contains('open')) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(formSnapshot('f-')));
        }
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    updateCalcPreview(prefix);
  });
}

function updateCalcPreview(p) {
  const box = document.getElementById(p + 'calc-preview');
  if (!box) return;
  const units = Number(document.getElementById(p + 'units')?.value || 0);
  const cog = Number(document.getElementById(p + 'cog')?.value || 0);
  const sp = Number(document.getElementById(p + 'sp')?.value || 0);
  const cogs = units * cog;
  const revenue = units * sp;
  const proceeds = (sp - cog) * units;
  const markup = calcMarkupRate(cog, sp);
  box.innerHTML = `
    <div class="calc-item"><span>Markup Rate</span><strong>${fmtPct(markup)}</strong></div>
    <div class="calc-item"><span>Total COGS</span><strong>${fmt(cogs)}</strong></div>
    <div class="calc-item"><span>Net Proceeds</span><strong>${fmt(proceeds)}</strong></div>
    <div class="calc-item"><span>Expected Sales</span><strong>${fmt(revenue)}</strong></div>`;
}

/* ── INIT ── */
ensureErrorSpans();
setupTextOnlyInputs();
setupLiveValidation();
setupDateRangeFilter();
setupEntryDatePickers();
setupEnterToSave();
setupThemeToggle();
setupDraftAndCalculations();

if (!data.length) {
  const autoBackup = localStorage.getItem('eed_matrix_auto_backup');
  if (autoBackup) {
    try {
      const backup = JSON.parse(autoBackup);
      if (backup.records && Array.isArray(backup.records) && backup.records.length) {
        const recover = confirm('Auto-backup found. Do you want to restore it?');
        if (recover) { data = backup.records; save(); toast('Auto-backup restored.'); }
      }
    } catch (err) { console.error('Auto-backup restore failed:', err); }
  }
}

render();
showDailyBackupReminder();

/* CERTIFICATE MAKER */
/* PDF-template certificate maker. This intentionally supersedes the older
   HTML/PNG preview above without changing the rest of the EED Matrix app. */
(function() {
  const certModal = document.getElementById('cert-modal');
  const btnCert = document.getElementById('btn-cert');
  const btnCertClose = document.getElementById('cert-close');
  const btnCertPrint = document.getElementById('cert-print');
  const wrap = document.getElementById('cert-scale-wrap');
  const stage = document.querySelector('.cert-pdf-page');
  const canvas = document.getElementById('cert-pdf-canvas');
  const overlay = document.getElementById('cert-overlay-layer');
  const templateUrl = 'assets/certificate-template.pdf';
  const fallbackTemplateUrl = 'assets/eed_certificate_of_approval.pdf';
  let certLayout = JSON.parse(localStorage.getItem(CERT_LAYOUT_KEY) || '{"s3Offset":0,"ctrlOffset":0}');

  if (!certModal || !btnCert || !stage || !canvas || !overlay) return;

  let pdfPage = null;
  let pageSize = { width: 842, height: 595 };
  let previewScale = 1;
  let renderTask = null;

  /* ── Cert field layout (coordinates in PDF units, origin bottom-left) ── */
  const certFields = {
    org: {
      inputId: 'c-org',
      x: 85, y: 322, width: 672, height: 66,
      fontSize: 52, minFontSize: 28, font: 'TimesRoman', weight: 'normal',
      align: 'center', lineHeight: 1.1, maxLines: 1
    },
    body: {
      type: 'body',
      x: 55, y: 205, width: 732, height: 103,
      fontSize: 14, minFontSize: 10, font: 'TimesRoman', weight: 'bold',
      align: 'center', lineHeight: 1.35, maxLines: 6
    },
    s1name: {
      inputId: 'c-s1name',
      x: 80, y: 130, width: 252, height: 20,
      fontSize: 15, minFontSize: 10, font: 'TimesRoman', weight: 'bold',
      align: 'center', lineHeight: 1.1, maxLines: 1
    },
    s1title: {
      inputId: 'c-s1title',
      x: 80, y: 110, width: 252, height: 18,
      fontSize: 13, minFontSize: 9, font: 'TimesRoman', weight: 'italic',
      align: 'center', lineHeight: 1.1, maxLines: 1
    },
    s2name: {
      inputId: 'c-s2name',
      x: 510, y: 130, width: 258, height: 20,
      fontSize: 15, minFontSize: 10, font: 'TimesRoman', weight: 'bold',
      align: 'center', lineHeight: 1.1, maxLines: 1
    },
    s2title: {
      inputId: 'c-s2title',
      x: 510, y: 110, width: 258, height: 18,
      fontSize: 13, minFontSize: 9, font: 'TimesRoman', weight: 'italic',
      align: 'center', lineHeight: 1.1, maxLines: 1
    },
    s3name: {
      inputId: 'c-s3name',
      x: 292, y: 82, width: 258, height: 20,
      fontSize: 15, minFontSize: 10, font: 'TimesRoman', weight: 'bold',
      align: 'center', lineHeight: 1.1, maxLines: 1
    },
    s3title: {
      inputId: 'c-s3title',
      x: 292, y: 63, width: 258, height: 18,
      fontSize: 13, minFontSize: 9, font: 'TimesRoman', weight: 'italic',
      align: 'center', lineHeight: 1.1, maxLines: 1
    },
    ctrlno: {
      inputId: 'c-ctrlno',
      prefix: 'CTRL NO. EED ',
      x: 636, y: 38, width: 158, height: 16,
      fontSize: 11, minFontSize: 9, font: 'Helvetica', weight: 'bold',
      align: 'right', lineHeight: 1.1, maxLines: 1
    }
  };
  const certBaseY = {
    s3name: certFields.s3name.y,
    s3title: certFields.s3title.y,
    ctrlno: certFields.ctrlno.y
  };

  function applyCertLayout() {
    const s3Offset = Number(certLayout.s3Offset || 0);
    const ctrlOffset = Number(certLayout.ctrlOffset || 0);
    certFields.s3name.y = certBaseY.s3name + s3Offset;
    certFields.s3title.y = certBaseY.s3title + s3Offset;
    certFields.ctrlno.y = certBaseY.ctrlno + ctrlOffset;
    const s3Input = document.getElementById('cert-s3-offset');
    const ctrlInput = document.getElementById('cert-ctrl-offset');
    if (s3Input) s3Input.value = s3Offset;
    if (ctrlInput) ctrlInput.value = ctrlOffset;
  }

  function saveCertLayout() {
    localStorage.setItem(CERT_LAYOUT_KEY, JSON.stringify(certLayout));
  }

  /* All input/select IDs that should trigger a live overlay re-render */
  const certInputs = [
    ...Object.values(certFields).map(field => field.inputId).filter(Boolean),
    'c-project', 'c-approvaldate', 'c-semester', 'c-ay', 'c-givendate'
  ];

  /* ── Date helpers ── */
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  function formatCertDate(isoValue, fallback) {
    if (!isoValue) return fallback;
    const parts = isoValue.split('-');
    if (parts.length !== 3) return isoValue;
    const [y, m, d] = parts.map(Number);
    if (!y || !m || !d) return fallback;
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }

  function inputValue(id, fallback = '') {
    const el = document.getElementById(id);
    return (el?.value || '').trim() || fallback;
  }

  function fieldText(key) {
    const field = certFields[key];
    if (key === 'body') return certificateBodyText();
    return (field.prefix || '') + inputValue(field.inputId);
  }

  function certificateBodyText() {
    const project      = inputValue('c-project', 'Organizational Shirt');
    const approvalDate = formatCertDate(inputValue('c-approvaldate'), 'February 13, 2026');
    const semester     = inputValue('c-semester', 'Second Semester');
    const ay           = inputValue('c-ay', '2025-2026');
    const givenDate    = formatCertDate(inputValue('c-givendate'), 'February 27, 2026');

    // Two paragraphs separated by a blank line, matching the certificate image
    return [
      `is hereby approved the Economic Enterprise Development Project \u201c${project}\u201d, the scope of which is defined within the approval letter dated ${approvalDate} and valid until the end of the ${semester} for the Academic Year ${ay}.`,
      `Given this ${givenDate}, of the Office of the Economic Enterprise Development Project under the Office of the Student Life and Success of the Pamantasan ng Lungsod ng San Pablo`
    ];
  }

  /* ── Canvas text helpers ── */
  function fontCss(field, fontSize) {
    const family = field.font === 'Helvetica' ? 'Arial, sans-serif' : "'Times New Roman', Georgia, serif";
    const style  = field.weight === 'italic' ? 'italic' : 'normal';
    const weight = (field.weight === 'bold' || field.font === 'Helvetica') ? '700' : '400';
    return `${style} ${weight} ${fontSize}px ${family}`;
  }

  function measureText(text, field, fontSize) {
    const ctx = measureText.ctx || (measureText.ctx = document.createElement('canvas').getContext('2d'));
    ctx.font = fontCss(field, fontSize);
    return ctx.measureText(text).width;
  }

  function wrapText(text, field, fontSize) {
    const lines = [];
    String(text).split('\n').forEach(part => {
      const words = part.split(/\s+/).filter(Boolean);
      let line = '';
      words.forEach(word => {
        const test = line ? `${line} ${word}` : word;
        if (measureText(test, field, fontSize) <= field.width || !line) {
          line = test;
        } else {
          lines.push(line);
          line = word;
        }
      });
      if (line) lines.push(line);
    });
    return lines;
  }

  function fitLines(text, field) {
    let fontSize = field.fontSize;
    let lines = [];
    // For body field with two paragraphs, join with a gap marker
    const source = Array.isArray(text) ? text.join('\n\n') : text;
    while (fontSize >= field.minFontSize) {
      lines = wrapText(source, field, fontSize);
      const lineHeight  = fontSize * field.lineHeight;
      const fitsWidth   = lines.every(line => measureText(line, field, fontSize) <= field.width);
      const fitsHeight  = lines.length * lineHeight <= field.height;
      const fitsLines   = !field.maxLines || lines.length <= field.maxLines;
      if (fitsWidth && fitsHeight && fitsLines) break;
      fontSize -= 1;
    }
    return { fontSize, lines: lines.slice(0, field.maxLines || lines.length) };
  }

  /* ── Overlay renderer (canvas-based live preview) ── */
  function renderOverlay() {
    applyCertLayout();
    overlay.innerHTML = '';
    Object.entries(certFields).forEach(([key, field]) => {
      const fitted = fitLines(fieldText(key), field);
      const div = document.createElement('div');
      div.className = 'cert-overlay-text';
      div.style.left        = `${field.x * previewScale}px`;
      div.style.top         = `${(pageSize.height - field.y - field.height) * previewScale}px`;
      div.style.width       = `${field.width * previewScale}px`;
      div.style.height      = `${field.height * previewScale}px`;
      div.style.font        = fontCss(field, fitted.fontSize * previewScale);
      div.style.lineHeight  = String(field.lineHeight);
      div.style.textAlign   = field.align;
      div.style.whiteSpace  = 'pre-wrap';
      div.style.display     = 'flex';
      div.style.alignItems  = 'center';
      div.style.justifyContent = field.align === 'center' ? 'center'
                               : field.align === 'right'  ? 'flex-end' : 'flex-start';
      div.style.flexDirection = 'column';
      div.textContent = fitted.lines.join('\n');
      overlay.appendChild(div);
    });
  }

  /* ── PDF preview (pdf.js) ── */
  async function loadPreviewPdf() {
    if (!window.pdfjsLib) throw new Error('PDF.js failed to load.');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument(templateUrl).promise
      .catch(() => pdfjsLib.getDocument(fallbackTemplateUrl).promise);
    pdfPage  = await pdf.getPage(1);
    pageSize = pdfPage.getViewport({ scale: 1 });
    await renderPdfPreview();
  }

  async function renderPdfPreview() {
    if (!pdfPage || !wrap) return;
    if (renderTask) { try { renderTask.cancel(); } catch (_) {} renderTask = null; }
    stage.style.transform = 'none';
    const maxWidth   = Math.max(320, wrap.clientWidth - 32);
    previewScale     = Math.min(1.35, maxWidth / pageSize.width);
    const viewport   = pdfPage.getViewport({ scale: previewScale });
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width  = Math.round(viewport.width  * pixelRatio);
    canvas.height = Math.round(viewport.height * pixelRatio);
    canvas.style.width  = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    stage.style.width   = `${viewport.width}px`;
    stage.style.height  = `${viewport.height}px`;
    wrap.style.height   = `${viewport.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    renderTask = pdfPage.render({ canvasContext: ctx, viewport });
    await renderTask.promise.catch(err => {
      if (err?.name !== 'RenderingCancelledException') throw err;
    });
    renderTask = null;
    renderOverlay();
  }

  /* ── Load PDF bytes via XHR (works on file:// unlike fetch) ── */
  function loadPdfBytes(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => xhr.status === 200 || xhr.status === 0
        ? resolve(xhr.response) : reject(new Error(`HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Network error loading PDF'));
      xhr.send();
    });
  }

  /* ── pdf-lib font name helper ── */
  function pdfFontName(field) {
    if (!window.PDFLib) return null;
    if (field.font === 'Helvetica') return PDFLib.StandardFonts.HelveticaBold;
    if (field.weight === 'bold')    return PDFLib.StandardFonts.TimesRomanBold;
    if (field.weight === 'italic')  return PDFLib.StandardFonts.TimesRomanItalic;
    return PDFLib.StandardFonts.TimesRoman;
  }

  /* ── Print / Save PDF — embeds text directly with pdf-lib ── */
  async function printCertificate() {
    if (!window.PDFLib) {
      toast('pdf-lib not loaded. Cannot generate PDF.', true);
      return;
    }
    applyCertLayout();

    toast('Generating certificate PDF…');

    // Load the template PDF bytes via XHR (works on file://)
    let bytes;
    try {
      bytes = await loadPdfBytes(templateUrl);
    } catch (_) {
      try {
        bytes = await loadPdfBytes(fallbackTemplateUrl);
      } catch (err) {
        toast('Could not load certificate template.', true);
        console.error(err);
        return;
      }
    }

    // Embed fonts and draw text with pdf-lib
    const pdfDoc = await PDFLib.PDFDocument.load(bytes);
    const page   = pdfDoc.getPages()[0];
    const PH     = page.getHeight(); // actual PDF page height in pts

    // Embed all needed fonts (deduplicated)
    const fontNames = new Set(Object.values(certFields).map(pdfFontName).filter(Boolean));
    const fonts = {};
    for (const name of fontNames) fonts[name] = await pdfDoc.embedFont(name);

    // Draw each field
    Object.entries(certFields).forEach(([key, field]) => {
      const fitted   = fitLines(fieldText(key), field);
      const font     = fonts[pdfFontName(field)];
      const fs       = fitted.fontSize;
      const lh       = fs * field.lineHeight;
      const blockH   = fitted.lines.length * lh;

      // Vertical centre inside the field box (pdf-lib origin = bottom-left)
      // field.y is the bottom of the box, field.height is the box height
      // We want to vertically centre the text block inside the box.
      // Top of block (in PDF units from bottom):
      const boxTop    = field.y + field.height;
      const blockTop  = boxTop - Math.max(0, (field.height - blockH) / 2) - fs;

      fitted.lines.forEach((line, i) => {
        const lineY = blockTop - i * lh;
        let lineX;
        const tw = font.widthOfTextAtSize(line, fs);
        if (field.align === 'center') lineX = field.x + (field.width - tw) / 2;
        else if (field.align === 'right') lineX = field.x + field.width - tw;
        else lineX = field.x;

        page.drawText(line, {
          x:     lineX,
          y:     lineY,
          size:  fs,
          font,
          color: PDFLib.rgb(0, 0, 0)
        });
      });
    });

    // Save and open in new tab (browser can print/save from there)
    const pdfBytes = await pdfDoc.save();
    const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
    const url      = URL.createObjectURL(blob);

    const org = inputValue('c-org', 'certificate')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const filename = `${org || 'certificate'}-eed-approval.pdf`;

    // Open in new tab — user can Ctrl+P or use browser's Download button
    const win = window.open(url, '_blank');
    if (win) {
      win.focus();
      toast('PDF opened — use the browser Print button (Ctrl+P) to print or save.');
    } else {
      // Pop-up blocked: fall back to download link
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('PDF downloaded.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* ── Pre-fill from last matrix entry ── */
  function prefillFromLastEntry() {
    if (!data.length && !certPrefillRecord) return;
    const last = certPrefillRecord || data[0];
    certPrefillRecord = null;

    // Control No: strip only the cert overlay prefix ("CTRL NO. EED "), leaving e.g. "26-27-0001"
    if (last.ctrlNo) {
      const ctrlPrefix = certFields.ctrlno.prefix || 'CTRL NO. EED ';
      document.getElementById('c-ctrlno').value = last.ctrlNo.startsWith(ctrlPrefix)
        ? last.ctrlNo.slice(ctrlPrefix.length)
        : last.ctrlNo;
    }

    if (last.org)          document.getElementById('c-org').value     = last.org;
    if (last.eed)          document.getElementById('c-project').value = last.eed;

    // Date Approved → Approval Letter Date and Given Date
    if (last.dateApproved) {
      setDateInputValue('c-approvaldate', last.dateApproved);
      setDateInputValue('c-givendate',    last.dateApproved);
    }
  }

  /* ── Open modal ── */
  async function openCertModal(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();
    if (location.protocol === 'file:') {
      toast('Open this app through XAMPP: http://localhost/EED_MATRIX/ so the certificate PDF can load.', true, null, 8000);
      return;
    }
    applyCertLayout();
    prefillFromLastEntry();
    certModal.classList.add('open');
    history.pushState({ certModal: true }, '');
    if (!pdfPage) await loadPreviewPdf();
    else await renderPdfPreview();
    renderOverlay();
  }

  /* ── Wire up flatpickr for cert date inputs ── */
  function setupCertDatePickers() {
    if (typeof flatpickr === 'undefined') return;
    ['c-approvaldate', 'c-givendate'].forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      flatpickr(input, {
        dateFormat:   'Y-m-d',
        altInput:     true,
        altFormat:    'F j, Y',   // "February 13, 2026"
        allowInput:   false,
        clickOpens:   true,
        disableMobile: true,
        onChange: () => renderOverlay()
      });
    });
  }

  /* ── Event listeners ── */
  btnCert.addEventListener('click', event => {
    openCertModal(event).catch(err => {
      console.error(err);
      toast(err.message || 'Unable to load certificate template.', true);
    });
  }, true);

  btnCertPrint?.addEventListener('click', event => {
    event?.preventDefault();
    event?.stopImmediatePropagation();
    if (!pdfPage) { toast('Certificate preview not loaded yet.', true); return; }
    printCertificate().catch(err => {
      console.error(err);
      toast(err.message || 'Could not generate certificate PDF.', true);
    });
  }, true);

  function closeCertModal() {
    if (certModal.classList.contains('open')) {
      certModal.classList.remove('open');
      if (history.state && history.state.certModal) history.back();
    }
  }

  btnCertClose?.addEventListener('click', () => {
    certModal.classList.remove('open');
  }, true);

  window.addEventListener('popstate', e => {
    if (certModal.classList.contains('open')) {
      certModal.classList.remove('open');
    }
  });

  // Live re-render on any input/select change
  certInputs.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input',  renderOverlay);
    el.addEventListener('change', renderOverlay); // catches <select> changes
  });

  ['cert-s3-offset', 'cert-ctrl-offset'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      certLayout.s3Offset = Number(document.getElementById('cert-s3-offset')?.value || 0);
      certLayout.ctrlOffset = Number(document.getElementById('cert-ctrl-offset')?.value || 0);
      saveCertLayout();
      renderOverlay();
    });
  });

  document.querySelectorAll('.cert-nudge').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.target === 's3' ? 's3Offset' : 'ctrlOffset';
      certLayout[key] = Number(certLayout[key] || 0) + Number(btn.dataset.delta || 0);
      saveCertLayout();
      renderOverlay();
    });
  });

  window.addEventListener('resize', () => {
    if (!certModal.classList.contains('open')) return;
    renderPdfPreview().catch(err => console.error(err));
  });

  setupCertDatePickers();
})();
