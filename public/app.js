/* global Swal */

const itemCountInput = document.querySelector('#item-count');
const designFields = document.querySelector('#design-fields');
const orderForm = document.querySelector('#order-form');
const autoUploadSection = document.querySelector('#auto-upload-section');
const notaScanStatus = document.querySelector('#nota-scan-status');
const submitBtn = document.querySelector('#submit-btn');
const previewNotaOrderCode = document.querySelector('#preview-nota-order-code');
const previewNotaDate = document.querySelector('#preview-nota-date');
const previewItemCount = document.querySelector('#preview-item-count');
const itemCountVisible = document.querySelector('#item-count-visible');
const addItemBtn = document.querySelector('#add-item-btn');
const applyItemCountBtn = document.querySelector('#apply-item-count-btn');
const notaManualHint = document.querySelector('#nota-manual-hint');
const flowStepper = document.querySelector('#flow-stepper');
const uploadReadiness = document.querySelector('#upload-readiness');
const uploadReadinessCount = document.querySelector('#upload-readiness-count');

let notaPreview = null;
let notaScanRequestId = 0;

const SWAL_DEFAULTS = {
  customClass: { popup: 'app-swal' },
  confirmButtonColor: '#0d6e5f',
  cancelButtonColor: '#6b7280'
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatMaxSizeLabel(mb) {
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)} detik`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} menit`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return `${hours} jam ${mins} menit`;
}

function getMaxFileMb() {
  return Number.parseInt(orderForm?.dataset.maxFileMb, 10) || 5120;
}

function getMaxFileBytes() {
  return getMaxFileMb() * 1024 * 1024;
}

/* ===== Upload Overlay (reliable untuk file multi-GB) ===== */

const uploadOverlay = {
  el: null,
  fill: null,
  loaded: null,
  percent: null,
  phase: null,
  speed: null,
  startTime: 0,
  lastLoaded: 0,
  lastTime: 0,
  isActive: false,

  init() {
    this.el = document.getElementById('upload-overlay');
    this.fill = document.getElementById('upload-overlay-fill');
    this.loaded = document.getElementById('upload-overlay-loaded');
    this.percent = document.getElementById('upload-overlay-percent');
    this.phase = document.getElementById('upload-overlay-phase');
    this.speed = document.getElementById('upload-overlay-speed');
  },

  show(phaseText = 'Mengirim file ke server...') {
    if (!this.el) this.init();
    if (this.phase) this.phase.textContent = phaseText;
    if (this.fill) this.fill.style.width = '0%';
    if (this.percent) this.percent.textContent = '0%';
    if (this.loaded) this.loaded.textContent = '0 B';
    if (this.speed) this.speed.textContent = '';

    this.el?.classList.remove('hidden');
    this.el?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('upload-active');
    this.isActive = true;
    this.startTime = Date.now();
    this.lastLoaded = 0;
    this.lastTime = this.startTime;
  },

  update(loaded, total) {
    const hasTotal = total > 0;
    const pct = hasTotal ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

    if (this.fill) {
      this.fill.style.width = hasTotal ? `${Math.max(pct, 1)}%` : '100%';
      if (!hasTotal) this.fill.classList.add('indeterminate');
      else this.fill.classList.remove('indeterminate');
    }
    if (this.percent) {
      this.percent.textContent = hasTotal ? `${pct}%` : '...';
    }
    if (this.loaded) {
      this.loaded.textContent = hasTotal
        ? `${formatBytes(loaded)} / ${formatBytes(total)}`
        : `${formatBytes(loaded)} terkirim`;
    }

    const now = Date.now();
    const elapsed = (now - this.lastTime) / 1000;
    if (elapsed >= 0.8 && loaded > this.lastLoaded) {
      const speedBps = (loaded - this.lastLoaded) / elapsed;
      const remaining = hasTotal && speedBps > 0 ? (total - loaded) / speedBps : 0;
      if (this.speed) {
        const speedText = `${formatBytes(speedBps)}/s`;
        const etaText = remaining > 0 ? ` · ~${formatDuration(remaining)} tersisa` : '';
        this.speed.textContent = speedText + etaText;
      }
      this.lastLoaded = loaded;
      this.lastTime = now;
    }
  },

  setPhase(text) {
    if (this.phase) this.phase.textContent = text;
  },

  hide() {
    this.el?.classList.add('hidden');
    this.el?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('upload-active');
    this.isActive = false;
    if (this.fill) {
      this.fill.classList.remove('indeterminate');
      this.fill.style.width = '0%';
    }
  }
};

window.addEventListener('beforeunload', (event) => {
  if (uploadOverlay.isActive) {
    event.preventDefault();
    event.returnValue = '';
  }
});

/* ===== File Drop Zone ===== */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setupFileDrop(dropEl, { onFileSelected, onFileCleared } = {}) {
  const input = dropEl.querySelector('input[type="file"]');
  const content = dropEl.querySelector('.file-drop-content');
  const selected = dropEl.querySelector('.file-selected');

  if (!input) return;

  function showSelected(file) {
    dropEl.classList.add('has-file');
    content.classList.add('hidden');
    selected.classList.remove('hidden');
    selected.innerHTML = `
      <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <div>
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-size">${formatBytes(file.size)}</div>
      </div>
      <button type="button" class="file-remove" aria-label="Hapus file">Hapus</button>
    `;

    dropEl.closest('.design-card')?.classList.add('is-complete');

    selected.querySelector('.file-remove').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      dropEl.classList.remove('has-file');
      content.classList.remove('hidden');
      selected.classList.add('hidden');
      selected.innerHTML = '';
      dropEl.closest('.design-card')?.classList.remove('is-complete');
      if (onFileCleared) onFileCleared();
      updateUploadReadiness();
    });

    if (onFileSelected) onFileSelected(file);
    updateUploadReadiness();
  }

  input.addEventListener('change', () => {
    if (input.files?.[0]) {
      showSelected(input.files[0]);
    }
  });

  dropEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropEl.classList.add('dragover');
  });

  dropEl.addEventListener('dragleave', () => {
    dropEl.classList.remove('dragover');
  });

  dropEl.addEventListener('drop', (event) => {
    event.preventDefault();
    dropEl.classList.remove('dragover');

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    showSelected(file);
  });
}

function setFlowStep(activeStep) {
  if (!flowStepper) return;

  flowStepper.querySelectorAll('.flow-step').forEach((stepEl) => {
    const step = Number.parseInt(stepEl.dataset.step, 10);
    stepEl.classList.toggle('is-active', step === activeStep);
    stepEl.classList.toggle('is-complete', step < activeStep);
  });
}

function countSelectedDesignFiles() {
  if (!designFields) return 0;

  let count = 0;
  designFields.querySelectorAll('input[type="file"]').forEach((input) => {
    if (input.files?.[0]?.size > 0) count += 1;
  });
  return count;
}

function updateUploadReadiness() {
  const requiredDesigns = Number.parseInt(itemCountInput?.value, 10)
    || notaPreview?.itemCount
    || Number.parseInt(itemCountInput?.value, 10)
    || 0;
  const selectedDesigns = countSelectedDesignFiles();
  const notaReady = Boolean(notaPreview?.itemCount);
  const allDesignsReady = notaReady && requiredDesigns > 0 && selectedDesigns >= requiredDesigns;

  if (uploadReadinessCount) {
    uploadReadinessCount.textContent = notaReady
      ? `${selectedDesigns}/${requiredDesigns}`
      : '0/0';
  }

  const labelEl = uploadReadiness?.querySelector('.upload-readiness-label');
  if (labelEl) {
    if (!notaReady) {
      labelEl.textContent = 'Mulai dengan upload nota PDF';
    } else if (selectedDesigns < requiredDesigns) {
      labelEl.textContent = `Lengkapi design — ${requiredDesigns - selectedDesigns} file lagi`;
    } else {
      labelEl.textContent = 'Siap diupload ke server';
    }
  }

  uploadReadiness?.classList.toggle('is-ready', allDesignsReady);
  if (submitBtn) submitBtn.disabled = !allDesignsReady;
}

function hideAutoUploadSection() {
  autoUploadSection?.classList.add('hidden');
  autoUploadSection?.classList.remove('is-revealed');
  if (designFields) designFields.innerHTML = '';
  setFlowStep(1);
  updateUploadReadiness();
}

function showAutoUploadSection() {
  autoUploadSection?.classList.remove('hidden');
  requestAnimationFrame(() => {
    autoUploadSection?.classList.add('is-revealed');
  });
  setFlowStep(3);
  updateUploadReadiness();
}

function setNotaScanStatus(kind, message) {
  if (!notaScanStatus) return;

  notaScanStatus.classList.remove('hidden', 'is-loading', 'is-success', 'is-error');
  notaScanStatus.classList.add(kind === 'loading' ? 'is-loading' : kind === 'success' ? 'is-success' : 'is-error');
  notaScanStatus.innerHTML = message;
}

function clearNotaScanStatus() {
  if (!notaScanStatus) return;
  notaScanStatus.classList.add('hidden');
  notaScanStatus.classList.remove('is-loading', 'is-success', 'is-error');
  notaScanStatus.innerHTML = '';
}

function buildItemInfoHtml(item) {
  const lineIndex = item?.lineIndex ? pad2(item.lineIndex) : '--';

  const meta = [];
  if (item?.qty) meta.push(`<span>Qty ${escapeHtml(item.qty)}</span>`);
  if (item?.sizeText) meta.push(`<span>${escapeHtml(item.sizeText)}</span>`);
  if (item?.finishingText) meta.push(`<span class="meta-finish">${escapeHtml(item.finishingText)}</span>`);
  if (item?.fileNameHint) meta.push(`<span class="meta-file">${escapeHtml(item.fileNameHint)}</span>`);

  return `
    <div class="design-item-info">
      <div class="design-card-top">
        <span class="design-index-pill">Item ${lineIndex}</span>
        <span class="design-status-pill">Menunggu file</span>
      </div>
      <h3 class="design-product-title">${escapeHtml(item?.productType || 'Produk tidak terbaca')}</h3>
      ${meta.length ? `<div class="design-item-meta">${meta.join('')}</div>` : ''}
    </div>
  `;
}

function getMaxItemsLimit() {
  return Number.parseInt(orderForm?.dataset.maxItems, 10) || 50;
}

function buildManualItems(count, existingItems = []) {
  const items = [];

  for (let index = 1; index <= count; index += 1) {
    const existing = existingItems[index - 1];
    items.push({
      lineIndex: index,
      productType: existing?.productType || existing?.product_type || `Item ${index}`,
      qty: existing?.qty || 1,
      sizeText: existing?.sizeText || existing?.size_text || null,
      finishingText: existing?.finishingText || existing?.finishing_text || null,
      fileNameHint: existing?.fileNameHint || existing?.file_name_hint || null
    });
  }

  return items;
}

function syncItemCountUi(count) {
  const safeCount = Math.min(Math.max(count, 1), getMaxItemsLimit());
  if (itemCountInput) itemCountInput.value = String(safeCount);
  if (itemCountVisible) itemCountVisible.value = String(safeCount);
  if (previewItemCount) previewItemCount.textContent = String(safeCount);
  return safeCount;
}

function applyManualItemCount(requestedCount) {
  const safeCount = syncItemCountUi(requestedCount);
  const baseItems = notaPreview?.items || [];
  const items = buildManualItems(safeCount, baseItems);

  notaPreview = {
    ...(notaPreview || {}),
    itemCount: safeCount,
    items,
    manual: true
  };

  renderDesignFields(items);
  updateUploadReadiness();
}

function renderDesignFields(items = []) {
  if (!itemCountInput || !designFields) return;

  const maxItems = getMaxItemsLimit();
  const count = items.length || Number.parseInt(itemCountInput.value, 10) || 1;
  const safeCount = Math.min(Math.max(count, 1), maxItems);

  syncItemCountUi(safeCount);
  designFields.innerHTML = '';

  for (let itemIndex = 1; itemIndex <= safeCount; itemIndex += 1) {
    const item = items[itemIndex - 1] || null;
    const row = document.createElement('article');
    row.className = 'design-row design-card';

    row.innerHTML = `
      ${buildItemInfoHtml(item ? { ...item, lineIndex: item.lineIndex || itemIndex } : { lineIndex: itemIndex })}
      <label class="field design-label-field">
        <strong>Label item (opsional)</strong>
        <input
          type="text"
          class="design-label-input"
          data-item-index="${itemIndex}"
          value="${escapeHtml(item?.productType || `Item ${itemIndex}`)}"
          maxlength="255"
        >
      </label>
      <label class="file-drop file-drop-compact" data-field="design_${itemIndex}">
        <input type="file" name="design_${itemIndex}" accept="image/jpeg,.jpg,.jpeg" required hidden>
        <div class="file-drop-content">
          <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span class="file-drop-text">Pilih JPEG untuk item ${pad2(itemIndex)}</span>
        </div>
        <div class="file-selected hidden"></div>
      </label>
    `;

    designFields.appendChild(row);

    const labelInput = row.querySelector('.design-label-input');
    labelInput?.addEventListener('input', () => {
      if (!notaPreview?.items?.[itemIndex - 1]) return;
      notaPreview.items[itemIndex - 1].productType = labelInput.value.trim() || `Item ${itemIndex}`;
      const title = row.querySelector('.design-product-title');
      if (title) title.textContent = notaPreview.items[itemIndex - 1].productType;
    });

    const dropEl = row.querySelector('.file-drop');
    const statusPill = row.querySelector('.design-status-pill');

    setupFileDrop(dropEl, {
      onFileSelected: () => {
        if (statusPill) {
          statusPill.textContent = 'File dipilih';
          statusPill.classList.add('is-done');
        }
      },
      onFileCleared: () => {
        if (statusPill) {
          statusPill.textContent = 'Menunggu file';
          statusPill.classList.remove('is-done');
        }
      }
    });
  }

  updateUploadReadiness();
}

function updateNotaSummary(preview) {
  if (previewNotaOrderCode) previewNotaOrderCode.textContent = preview.notaOrderCode || '-';
  if (previewNotaDate) previewNotaDate.textContent = preview.notaDate || '-';
  if (previewItemCount) previewItemCount.textContent = String(preview.itemCount || '-');
}

function resetNotaWorkflow() {
  notaPreview = null;
  if (itemCountInput) itemCountInput.value = '1';
  hideAutoUploadSection();
  clearNotaScanStatus();
}

async function scanNotaFile(file) {
  const requestId = ++notaScanRequestId;
  notaPreview = null;
  hideAutoUploadSection();

  setFlowStep(2);
  setNotaScanStatus(
    'loading',
    '<span class="nota-scan-spinner" aria-hidden="true"></span> Membaca nota… Ini bisa memakan waktu untuk nota scan.'
  );

  const formData = new FormData();
  formData.append('nota', file);

  try {
    const response = await fetch('/api/nota/preview', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Gagal membaca nota.');
    }

    if (requestId !== notaScanRequestId) return;

    notaPreview = data;

    if (data.needsManual || !data.itemCount) {
      notaPreview = {
        ...data,
        itemCount: 1,
        items: buildManualItems(1),
        manual: true
      };
      if (notaManualHint) notaManualHint.classList.remove('hidden');
      updateNotaSummary({ ...data, itemCount: 1 });
      applyManualItemCount(1);
      showAutoUploadSection();
      setNotaScanStatus(
        'error',
        `${escapeHtml(data.warning || 'Nota tidak terbaca penuh.')} Atur jumlah item manual di bawah.`
      );
      return;
    }

    if (notaManualHint) notaManualHint.classList.add('hidden');
    updateNotaSummary(data);
    renderDesignFields(data.items || []);
    showAutoUploadSection();

    setNotaScanStatus(
      'success',
      `Nota <strong>${escapeHtml(data.notaOrderCode || 'Tanpa kode')}</strong> · ${escapeHtml(data.itemCount)} item · ${escapeHtml(data.ocrEngine || 'ocr')}`
    );
  } catch (error) {
    if (requestId !== notaScanRequestId) return;

    notaPreview = {
      itemCount: 1,
      items: buildManualItems(1),
      manual: true,
      ocrFailed: true
    };
    if (notaManualHint) notaManualHint.classList.remove('hidden');
    applyManualItemCount(1);
    showAutoUploadSection();
    setFlowStep(2);
    setNotaScanStatus('error', `${escapeHtml(error.message)} Lanjutkan dengan pengaturan manual item.`);
  }
}

function setupManualItemControls() {
  applyItemCountBtn?.addEventListener('click', () => {
    const value = Number.parseInt(itemCountVisible?.value, 10) || 1;
    applyManualItemCount(value);
  });

  addItemBtn?.addEventListener('click', () => {
    const current = Number.parseInt(itemCountVisible?.value, 10)
      || Number.parseInt(itemCountInput?.value, 10)
      || 1;
    applyManualItemCount(current + 1);
  });

  itemCountVisible?.addEventListener('change', () => {
    applyManualItemCount(Number.parseInt(itemCountVisible.value, 10) || 1);
  });
}

setupManualItemControls();

function setupNotaDrop() {
  const notaDrop = document.querySelector('#nota-drop');
  if (!notaDrop) return;

  const input = notaDrop.querySelector('input[type="file"]');
  const content = notaDrop.querySelector('.file-drop-content');
  const selected = notaDrop.querySelector('.file-selected');

  if (!input) return;

  function showSelected(file) {
    notaDrop.classList.add('has-file');
    content.classList.add('hidden');
    selected.classList.remove('hidden');
    selected.innerHTML = `
      <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <div>
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-size">${formatBytes(file.size)}</div>
      </div>
      <button type="button" class="file-remove" aria-label="Hapus file">Hapus</button>
    `;

    selected.querySelector('.file-remove').addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      notaDrop.classList.remove('has-file');
      content.classList.remove('hidden');
      selected.classList.add('hidden');
      selected.innerHTML = '';
      resetNotaWorkflow();
    });

    scanNotaFile(file);
  }

  input.addEventListener('change', () => {
    if (input.files?.[0]) {
      showSelected(input.files[0]);
    }
  });

  notaDrop.addEventListener('dragover', (event) => {
    event.preventDefault();
    notaDrop.classList.add('dragover');
  });

  notaDrop.addEventListener('dragleave', () => {
    notaDrop.classList.remove('dragover');
  });

  notaDrop.addEventListener('drop', (event) => {
    event.preventDefault();
    notaDrop.classList.remove('dragover');

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    showSelected(file);
  });
}

setupNotaDrop();
hideAutoUploadSection();
setFlowStep(1);
updateUploadReadiness();

/* ===== Client-side Validation ===== */

function validateForm(formData) {
  const maxBytes = getMaxFileBytes();
  const maxLabel = formatMaxSizeLabel(getMaxFileMb());
  const errors = [];

  const nota = formData.get('nota');
  if (nota instanceof File && nota.size > 0) {
    if (nota.size > maxBytes) {
      errors.push(`Nota "${nota.name}" melebihi batas ${maxLabel} (${formatBytes(nota.size)}).`);
    }
    if (!nota.name.toLowerCase().endsWith('.pdf') && nota.type !== 'application/pdf') {
      errors.push('Nota harus berformat PDF.');
    }
  } else {
    errors.push('Nota PDF wajib diupload.');
  }

  const itemCount = Number.parseInt(formData.get('item_count'), 10) || 0;
  if (!itemCount || itemCount < 1) {
    errors.push('Jumlah item wajib diisi minimal 1.');
  }

  if (!notaPreview && itemCount < 1) {
    errors.push('Upload nota atau atur jumlah item manual sebelum upload design.');
  }
  for (let i = 1; i <= itemCount; i += 1) {
    const design = formData.get(`design_${i}`);
    if (design instanceof File && design.size > 0) {
      if (design.size > maxBytes) {
        errors.push(`Design item ${pad2(i)} "${design.name}" melebihi batas ${maxLabel}.`);
      }
      const isJpeg = design.type === 'image/jpeg'
        || design.name.toLowerCase().endsWith('.jpg')
        || design.name.toLowerCase().endsWith('.jpeg');
      if (!isJpeg) {
        errors.push(`Design item ${pad2(i)} harus berformat JPEG/JPG.`);
      }
    }
  }

  return errors;
}

function getTotalUploadSize(formData) {
  let total = 0;
  for (const [, value] of formData.entries()) {
    if (value instanceof File) {
      total += value.size;
    }
  }
  return total;
}

/* ===== Form Submit with XHR Progress ===== */

function uploadWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/orders');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.addEventListener('progress', (event) => {
      if (onProgress) {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      }
    });

    xhr.upload.addEventListener('loadstart', () => {
      if (onProgress) onProgress(0, 0);
    });

    xhr.addEventListener('load', () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error('Respons server tidak valid.'));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(new Error(data.error || `Upload gagal (HTTP ${xhr.status}).`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Koneksi terputus. Periksa jaringan Anda.'));
    });

    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timeout. Coba lagi dengan koneksi yang lebih stabil.'));
    });

    xhr.timeout = 0;
    xhr.send(formData);
  });
}

if (orderForm) {
  orderForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitBtn = document.querySelector('#submit-btn');
    const formData = new FormData(orderForm);

    const errors = validateForm(formData);
    if (errors.length > 0) {
      await Swal.fire({
        ...SWAL_DEFAULTS,
        icon: 'error',
        title: 'Validasi Gagal',
        html: errors.map((e) => `<div style="text-align:left;margin:4px 0">• ${e}</div>`).join(''),
        confirmButtonText: 'Perbaiki'
      });
      return;
    }

    const totalSize = getTotalUploadSize(formData);
    const totalSizeLabel = formatBytes(totalSize);

    const result = await Swal.fire({
      ...SWAL_DEFAULTS,
      title: 'Konfirmasi Upload',
      html: `
        <p>Total ${totalSizeLabel} akan diupload ke server.</p>
        <p style="font-size:0.85rem;color:#6b7280">Setelah diterima, file akan diproses dan diupload ke Google Drive secara otomatis.</p>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Upload',
      cancelButtonText: 'Batal'
    });

    if (!result.isConfirmed) return;

    submitBtn.disabled = true;
    uploadOverlay.show('Mengirim file ke server...');

    try {
      const response = await uploadWithProgress(formData, (loaded, total) => {
        uploadOverlay.update(loaded, total);
      });

      uploadOverlay.setPhase('Order diterima server. Menyiapkan redirect...');
      uploadOverlay.update(1, 1);

      uploadOverlay.hide();

      await Swal.fire({
        ...SWAL_DEFAULTS,
        icon: 'success',
        title: 'Order Diterima!',
        html: `
          <p><strong>${response.orderCode}</strong> berhasil dibuat.</p>
          <p style="font-size:0.85rem;color:#6b7280">Upload ke Google Drive sedang berjalan di server.</p>
        `,
        confirmButtonText: 'Lihat Progress'
      });

      window.location.href = `/orders/${response.orderCode}`;
    } catch (error) {
      uploadOverlay.hide();
      submitBtn.disabled = false;

      await Swal.fire({
        ...SWAL_DEFAULTS,
        icon: 'error',
        title: 'Upload Gagal',
        text: error.message,
        confirmButtonText: 'Coba Lagi'
      });
    }
  });
}

/* ===== Order Status Polling ===== */

const statusTracker = document.querySelector('#status-tracker');

if (statusTracker) {
  const orderCode = statusTracker.dataset.orderCode;
  let currentStatus = statusTracker.dataset.status;
  let pollTimer;

  const progressSection = document.getElementById('progress-section');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressLabel = document.getElementById('progress-label');
  const progressDetail = document.getElementById('progress-detail');
  const statusBadge = document.getElementById('status-badge');
  const fileCount = document.getElementById('file-count');
  const driveFolder = document.getElementById('drive-folder');
  const errorAlert = document.getElementById('error-alert');
  const filesTableBody = document.getElementById('files-table-body');
  const ocrStatusBadge = document.getElementById('ocr-status-badge');
  const ocrItemsBody = document.getElementById('ocr-items-body');
  const ocrNotaOrderCode = document.getElementById('ocr-nota-order-code');
  const ocrNotaDate = document.getElementById('ocr-nota-date');
  const ocrItemCount = document.getElementById('ocr-item-count');
  const ocrItemMatch = document.getElementById('ocr-item-match');
  const ocrEngine = document.getElementById('ocr-engine');
  const ocrConfidence = document.getElementById('ocr-confidence');
  const ocrCustomerId = document.getElementById('ocr-customer-id');
  const ocrErrorAlert = document.getElementById('ocr-error-alert');
  let currentOcrStatus = statusTracker.dataset.ocrStatus || null;

  const phaseLabels = {
    waiting: 'Menunggu worker...',
    uploading: 'Mengupload ke Google Drive',
    saving: 'Menyimpan metadata...',
    done: 'Selesai'
  };

  function formatOcrConfidence(value) {
    if (value === null || value === undefined) return '-';
    const percent = Number(value) * 100;
    return Number.isFinite(percent) ? `${percent.toFixed(1)}%` : '-';
  }

  function updateOcrPanel(ocr, itemCount) {
    if (!ocr) return;

    if (ocrStatusBadge) {
      ocrStatusBadge.textContent = ocr.statusLabel || ocr.status;
      ocrStatusBadge.className = `status status-${ocr.status}`;
    }
    if (ocrNotaOrderCode) ocrNotaOrderCode.textContent = ocr.notaOrderCode || '-';
    if (ocrNotaDate) ocrNotaDate.textContent = ocr.notaDate || '-';
    if (ocrItemCount) {
      ocrItemCount.textContent = `${ocr.itemCountDetected ?? '-'} / ${itemCount}`;
    }
    if (ocrItemMatch) {
      const match = ocr.itemCountMatch;
      ocrItemMatch.textContent = match === null ? '-' : match ? 'Cocok' : 'Tidak cocok';
      ocrItemMatch.className = `status ${match === null ? '' : match ? 'status-completed' : 'status-failed'}`;
    }
    if (ocrEngine) ocrEngine.textContent = ocr.ocrEngine || '-';
    if (ocrConfidence) ocrConfidence.textContent = formatOcrConfidence(ocr.ocrConfidence);
    if (ocrCustomerId) ocrCustomerId.textContent = ocr.customerAnonId || '-';
    if (ocrErrorAlert) {
      if (ocr.errorMessage) {
        ocrErrorAlert.textContent = ocr.errorMessage;
        ocrErrorAlert.classList.remove('hidden');
      } else {
        ocrErrorAlert.classList.add('hidden');
      }
    }
    if (ocrItemsBody && ocr.items?.length) {
      ocrItemsBody.innerHTML = ocr.items.map((item) => `
        <tr>
          <td>${item.lineIndex}</td>
          <td>${item.productType || '-'}</td>
          <td>${item.qty ?? '-'}</td>
          <td>${item.sizeText || '-'}</td>
          <td>${item.fileNameHint || '-'}</td>
        </tr>
      `).join('');
    }
  }

  function updateFilesTable(files) {
    if (!filesTableBody) return;

    if (!files.length) {
      filesTableBody.innerHTML = '<tr><td colspan="7" class="empty">Belum ada file.</td></tr>';
      return;
    }

    filesTableBody.innerHTML = files.map((file) => `
      <tr data-file-id="${file.id}">
        <td><span class="role-badge role-${file.fileRole}">${file.fileRole}</span></td>
        <td>${file.itemIndex ?? '-'}</td>
        <td>${file.designIndex ?? '-'}</td>
        <td>${file.storedFileName}</td>
        <td>${formatBytes(file.sizeBytes)}</td>
        <td><code class="drive-id">${file.googleDriveFileId}</code></td>
        <td>
          ${file.fileRole === 'design'
            ? `<button type="button" class="danger-button small-button delete-file-btn" data-file-id="${file.id}" data-order-code="${orderCode}">Hapus</button>`
            : '-'}
        </td>
      </tr>
    `).join('');
  }

  async function pollStatus() {
    try {
      const response = await fetch(`/api/orders/${orderCode}/status`);
      if (!response.ok) return;

      const data = await response.json();
      const { progress, status, statusLabel } = data;

      if (progressFill) {
        progressFill.style.width = `${progress.percent}%`;
      }
      if (progressPercent) {
        progressPercent.textContent = `${progress.percent}%`;
      }
      if (progressLabel) {
        progressLabel.textContent = phaseLabels[progress.phase] || 'Memproses...';
      }
      if (progressDetail && progress.currentFile) {
        const fileDetail = progress.fileTotalBytes
          ? ` · ${formatBytes(progress.fileBytesRead || 0)} / ${formatBytes(progress.fileTotalBytes)}`
          : '';
        progressDetail.textContent = `File: ${progress.currentFile} (${progress.filesUploaded + 1}/${progress.totalFiles})${fileDetail}`;
      } else if (progressDetail) {
        progressDetail.textContent = phaseLabels[progress.phase] || '';
      }

      if (statusBadge && status !== currentStatus) {
        statusBadge.textContent = statusLabel;
        statusBadge.className = `status status-${status}`;
      }

      if (fileCount) {
        fileCount.textContent = `${data.files.length} / ${data.itemCount + 1}`;
      }

      const summaryItemCount = document.getElementById('summary-item-count');
      if (summaryItemCount) {
        summaryItemCount.textContent = String(data.itemCount);
      }

      const adminItemCount = document.getElementById('admin-item-count');
      if (adminItemCount) {
        adminItemCount.value = String(data.itemCount);
      }

      if (driveFolder && data.googleDriveFolderId) {
        driveFolder.textContent = data.googleDriveFolderId;
      }

      if (data.files.length > 0) {
        updateFilesTable(data.files);
      }

      if (data.ocr) {
        updateOcrPanel(data.ocr, data.itemCount);
        currentOcrStatus = data.ocr.status;
      }

      if (data.errorMessage && errorAlert) {
        errorAlert.textContent = data.errorMessage;
        errorAlert.classList.remove('hidden');
      }

      const uploadFinished = status === 'completed' || status === 'failed';
      const ocrFinished = !data.ocr || data.ocr.status === 'completed' || data.ocr.status === 'failed';

      if (status === 'completed') {
        if (progressSection) progressSection.classList.add('hidden');

        if (ocrFinished) {
          clearInterval(pollTimer);
          Swal.fire({
            ...SWAL_DEFAULTS,
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Upload ke Google Drive selesai!',
            showConfirmButton: false,
            timer: 4000,
            timerProgressBar: true
          });
        }
      } else if (status === 'failed') {
        if (progressSection) progressSection.classList.add('hidden');
        if (ocrFinished) clearInterval(pollTimer);

        Swal.fire({
          ...SWAL_DEFAULTS,
          icon: 'error',
          title: 'Upload Gagal',
          text: data.errorMessage || 'Terjadi kesalahan saat upload ke Google Drive.',
          confirmButtonText: 'OK'
        });
      } else if (uploadFinished && ocrFinished) {
        clearInterval(pollTimer);
      }

      currentStatus = status;
    } catch {
      // Retry on next poll
    }
  }

  if (currentStatus === 'processing' || currentOcrStatus === 'processing') {
    if (progressSection && currentStatus === 'processing') {
      progressSection.classList.remove('hidden');
    }
    pollStatus();
    pollTimer = setInterval(pollStatus, 2000);
  } else if (currentStatus === 'completed' && progressFill) {
    progressFill.style.width = '100%';
    if (progressPercent) progressPercent.textContent = '100%';
  }
}

/* ===== Retry Failed Order ===== */

const retryBtn = document.querySelector('#retry-btn');

if (retryBtn) {
  retryBtn.addEventListener('click', async () => {
    const orderCode = retryBtn.dataset.orderCode;

    const confirm = await Swal.fire({
      ...SWAL_DEFAULTS,
      title: 'Retry Upload?',
      text: 'Upload ke Google Drive akan dijalankan ulang dari file lokal.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Retry',
      cancelButtonText: 'Batal'
    });

    if (!confirm.isConfirmed) return;

    retryBtn.disabled = true;

    try {
      const response = await fetch(`/api/orders/${orderCode}/retry`, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Retry gagal.');
      }

      await Swal.fire({
        ...SWAL_DEFAULTS,
        icon: 'success',
        title: 'Retry Dijadwalkan',
        text: 'Upload ke Google Drive sedang berjalan ulang.',
        confirmButtonText: 'OK'
      });

      window.location.reload();
    } catch (error) {
      retryBtn.disabled = false;

      await Swal.fire({
        ...SWAL_DEFAULTS,
        icon: 'error',
        title: 'Retry Gagal',
        text: error.message,
        confirmButtonText: 'OK'
      });
    }
  });
}

/* ===== Show server-side error on form page ===== */

function showServerErrorAlert() {
  const alertEl = document.querySelector('.alert[role="alert"]');
  if (alertEl && orderForm) {
    Swal.fire({
      ...SWAL_DEFAULTS,
      icon: 'error',
      title: 'Terjadi Kesalahan',
      text: alertEl.textContent,
      confirmButtonText: 'OK'
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', showServerErrorAlert);
} else {
  showServerErrorAlert();
}

/* ===== Order Admin (override item count & delete design) ===== */

const orderItemCountForm = document.querySelector('#order-item-count-form');
const orderAdminPanel = document.querySelector('#order-admin-panel');

if (orderItemCountForm && orderAdminPanel) {
  orderItemCountForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const orderCode = orderAdminPanel.dataset.orderCode;
    const itemCountInput = document.querySelector('#admin-item-count');
    const itemCount = Number.parseInt(itemCountInput?.value, 10);

    try {
      const response = await fetch(`/api/orders/${orderCode}/item-count`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemCount })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Gagal memperbarui jumlah item.');
      }

      await Swal.fire({
        ...SWAL_DEFAULTS,
        icon: 'success',
        title: 'Jumlah Item Diperbarui',
        text: `Order ${data.orderCode} sekarang ${data.itemCount} item.`,
        confirmButtonText: 'OK'
      });

      window.location.reload();
    } catch (error) {
      await Swal.fire({
        ...SWAL_DEFAULTS,
        icon: 'error',
        title: 'Gagal',
        text: error.message,
        confirmButtonText: 'OK'
      });
    }
  });
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-file-btn');
  if (!button) return;

  const orderCode = button.dataset.orderCode;
  const fileId = button.dataset.fileId;

  const confirm = await Swal.fire({
    ...SWAL_DEFAULTS,
    title: 'Hapus file design?',
    text: 'File akan dihapus dari database, server, dan Google Drive jika memungkinkan.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Ya, Hapus',
    cancelButtonText: 'Batal'
  });

  if (!confirm.isConfirmed) return;

  button.disabled = true;

  try {
    const response = await fetch(`/api/orders/${orderCode}/files/${fileId}`, {
      method: 'DELETE'
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Gagal menghapus file.');
    }

    await Swal.fire({
      ...SWAL_DEFAULTS,
      icon: 'success',
      title: 'File Dihapus',
      text: data.message,
      confirmButtonText: 'OK'
    });

    window.location.reload();
  } catch (error) {
    button.disabled = false;

    await Swal.fire({
      ...SWAL_DEFAULTS,
      icon: 'error',
      title: 'Gagal',
      text: error.message,
      confirmButtonText: 'OK'
    });
  }
});
