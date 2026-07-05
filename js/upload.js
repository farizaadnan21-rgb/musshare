/**
 * upload.js — Music Library + Upload Module
 * Shows uploaded files from server and handles compact file upload.
 */

const Upload = (() => {
  // State
  let uploadedFiles = [];  // { id, file, name, size, sizeFormatted, status, progress, objectUrl }
  let fileIdCounter = 0;

  // DOM refs (lazy-init)
  let uploadInput, fileListEl, uploadBtn, clearBtn, statsEl, progressArea;
  let libraryList, libraryEmpty, libraryCount, uploadTriggerBtn;

  // Accepted formats
  const ACCEPTED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/webm'];
  const ACCEPTED_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.weba'];
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

  function init() {
    uploadInput     = document.getElementById('upload-input');
    fileListEl      = document.getElementById('upload-file-list');
    uploadBtn       = document.getElementById('upload-btn');
    clearBtn        = document.getElementById('upload-clear-btn');
    statsEl         = document.getElementById('upload-stats');
    progressArea    = document.getElementById('upload-progress-area');
    libraryList     = document.getElementById('library-list');
    libraryEmpty    = document.getElementById('library-empty');
    libraryCount    = document.getElementById('library-count');
    uploadTriggerBtn = document.getElementById('upload-trigger-btn');

    // Small upload button opens file picker
    uploadTriggerBtn.addEventListener('click', () => uploadInput.click());

    // File input change
    uploadInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      uploadInput.value = '';
    });

    // Drag & Drop on the whole library card
    const libraryCard = document.getElementById('library-card');
    libraryCard.addEventListener('dragover', (e) => {
      e.preventDefault();
      libraryCard.style.outline = '3px dashed var(--clr-blue)';
      libraryCard.style.outlineOffset = '-6px';
    });
    libraryCard.addEventListener('dragleave', () => {
      libraryCard.style.outline = '';
      libraryCard.style.outlineOffset = '';
    });
    libraryCard.addEventListener('drop', (e) => {
      e.preventDefault();
      libraryCard.style.outline = '';
      libraryCard.style.outlineOffset = '';
      handleFiles(e.dataTransfer.files);
    });

    // Upload all button
    uploadBtn.addEventListener('click', uploadAll);

    // Clear all button
    clearBtn.addEventListener('click', clearAll);

    // Load library from server
    fetchLibrary();
    // Refresh library every 10 seconds
    setInterval(fetchLibrary, 10_000);
  }

  // ==================== LIBRARY (Server Files) ====================

  /**
   * Mengambil daftar lagu yang ada di Server Java secara berkala.
   * Endpoint: /list_files
   */
  async function fetchLibrary() {
    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/list_files`);
      if (!res.ok) return;
      const data = await res.json();
      renderLibrary(data.files || []);
    } catch (e) {
      // Silently fail
    }
  }

  /**
   * Menggambar (render) daftar lagu hasil dari fetchLibrary() ke layar.
   * Fungsi ini juga bertugas memunculkan tombol "Hapus" hanya jika 
   * Node-ID di browser cocok dengan pemilik file tersebut (f.uploadedBy).
   */
  function renderLibrary(files) {
    if (libraryCount) {
      libraryCount.textContent = files.length + ' File' + (files.length !== 1 ? 's' : '');
    }

    if (files.length === 0) {
      libraryEmpty.style.display = 'block';
      // Clear any existing items but keep empty state
      const items = libraryList.querySelectorAll('.library-item');
      items.forEach(i => i.remove());
      return;
    }

    libraryEmpty.style.display = 'none';

    // Build library HTML
    let html = '';
    files.forEach(f => {
      const sizeStr = (f.size / (1024 * 1024)).toFixed(2) + ' MB';
      const d = new Date(f.modified);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

      // Owner tags
      let ownersHtml = '';
      if (f.owners && f.owners.length > 0) {
        ownersHtml = f.owners.slice(0, 3).map(o => `<span class="library-node-badge">${Logger.escapeHTML(o)}</span>`).join('');
        if (f.owners.length > 3) ownersHtml += `<span class="library-node-badge">+${f.owners.length - 3}</span>`;
      }

      const escapedName = Logger.escapeHTML(f.name);
      const isOwner = f.uploadedBy === window.AppConfig.NODE_ID;

      html += `
        <div class="library-item">
          <div class="library-item-icon">🎵</div>
          <div class="library-item-info">
            <div class="library-item-name" title="${escapedName}">${escapedName}</div>
            <div class="library-item-meta">
              <span>${sizeStr}</span>
              <span>•</span>
              <span>${dateStr}</span>
            </div>
            ${ownersHtml ? `<div class="library-item-owners">${ownersHtml}</div>` : ''}
          </div>
          <div class="library-item-actions">
            <button class="neo-btn-play-sm" onclick="Player.play('${escapedName}', 'Server')">
              ▶ Play
            </button>
            ${isOwner ? `
            <button class="neo-btn-danger-sm" onclick="Upload.deleteServerFile('${escapedName}')" title="Hapus File">
              🗑️
            </button>` : ''}
          </div>
        </div>
      `;
    });

    // Replace content (keep empty state element)
    const items = libraryList.querySelectorAll('.library-item');
    items.forEach(i => i.remove());
    libraryList.insertAdjacentHTML('beforeend', html);
  }

  /**
   * Menghapus lagu dari Server. Mengirim HTTP DELETE dan 
   * Header X-Node-Id agar server dapat memverifikasi kepemilikan file.
   */
  async function deleteServerFile(filename) {
    if (!confirm(`Yakin ingin menghapus file "${filename}" dari server?`)) return;
    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/delete_file?filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
        headers: {
          'X-Node-Id': window.AppConfig.NODE_ID
        }
      });
      if (res.ok) {
        Logger.append(`File berhasil dihapus: ${filename}`, 'success');
        fetchLibrary(); // refresh UI
      } else {
        const errJson = await res.json().catch(() => ({}));
        Logger.append(`Gagal menghapus file: ${errJson.error || res.status}`, 'error');
      }
    } catch (e) {
      Logger.append(`Error saat menghapus file: ${e.message}`, 'error');
    }
  }

  // ==================== UPLOAD ====================

  function handleFiles(fileList) {
    for (const file of fileList) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.includes(ext)) {
        Logger.append(`Gagal: "${file.name}" bukan file audio yang didukung.`, 'error');
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        Logger.append(`Gagal: "${file.name}" melebihi batas 100MB.`, 'error');
        continue;
      }
      if (uploadedFiles.some(f => f.name === file.name && f.size === file.size)) {
        Logger.append(`Dilewati: "${file.name}" sudah ada dalam daftar.`, 'warning');
        continue;
      }

      const id = ++fileIdCounter;
      const objectUrl = URL.createObjectURL(file);

      uploadedFiles.push({
        id, file,
        name: file.name,
        size: file.size,
        sizeFormatted: formatSize(file.size),
        status: 'pending',
        progress: 0,
        objectUrl,
      });

      Logger.append(`File ditambahkan: "${file.name}" (${formatSize(file.size)})`, 'info');
    }

    updateUploadUI();
  }

  function removeFile(id) {
    const idx = uploadedFiles.findIndex(f => f.id === id);
    if (idx !== -1) {
      const removed = uploadedFiles.splice(idx, 1)[0];
      URL.revokeObjectURL(removed.objectUrl);
      Logger.append(`File dihapus: "${removed.name}"`, 'warning');
    }
    updateUploadUI();
  }

  function clearAll() {
    uploadedFiles.forEach(f => URL.revokeObjectURL(f.objectUrl));
    uploadedFiles = [];
    Logger.append('Semua file upload dihapus.', 'info');
    updateUploadUI();
  }

  function uploadAll() {
    const pending = uploadedFiles.filter(f => f.status === 'pending');
    if (pending.length === 0) {
      Logger.append('Tidak ada file baru untuk diupload.', 'warning');
      return;
    }

    Logger.append(`Memulai upload ${pending.length} file ke server...`, 'info');
    uploadBtn.disabled = true;

    pending.forEach((fileEntry, idx) => {
      setTimeout(() => realUpload(fileEntry), idx * 500);
    });
  }

  function realUpload(fileEntry) {
    fileEntry.status = 'uploading';
    fileEntry.progress = 0;
    updateUploadUI();

    Logger.append(`Uploading "${fileEntry.name}" ke server...`, '');

    const formData = new FormData();
    formData.append('file', fileEntry.file);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        fileEntry.progress = Math.round((e.loaded / e.total) * 100);
        updateUploadUI();
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        fileEntry.status = 'complete';
        fileEntry.progress = 100;
        Logger.append(`Upload selesai: "${fileEntry.name}" tersimpan di server.`, 'success');
        // Refresh library to show new file
        setTimeout(fetchLibrary, 500);
      } else {
        fileEntry.status = 'error';
        Logger.append(`Gagal upload "${fileEntry.name}": HTTP ${xhr.status}`, 'error');
      }
      checkAllDone();
      updateUploadUI();
    });

    xhr.addEventListener('error', () => {
      fileEntry.status = 'error';
      Logger.append(`Gagal upload "${fileEntry.name}": Network error`, 'error');
      checkAllDone();
      updateUploadUI();
    });

    xhr.open('POST', `${window.AppConfig.BACKEND_URL}/upload`);
    xhr.setRequestHeader('X-Node-Id', window.AppConfig.NODE_ID);
    xhr.send(formData);
  }

  function checkAllDone() {
    const stillUploading = uploadedFiles.some(f => f.status === 'uploading');
    if (!stillUploading) {
      uploadBtn.disabled = false;
      const completed = uploadedFiles.filter(f => f.status === 'complete').length;
      const failed = uploadedFiles.filter(f => f.status === 'error').length;
      Logger.append(`Selesai: ${completed} berhasil, ${failed} gagal.`, completed > 0 ? 'success' : 'warning');

      // Auto-clear completed files after 3 seconds
      setTimeout(() => {
        uploadedFiles = uploadedFiles.filter(f => f.status !== 'complete');
        updateUploadUI();
      }, 3000);
    }
  }

  function updateUploadUI() {
    // Show/hide progress area
    if (uploadedFiles.length === 0) {
      progressArea.style.display = 'none';
      return;
    }

    progressArea.style.display = 'block';
    clearBtn.disabled = false;
    uploadBtn.disabled = !uploadedFiles.some(f => f.status === 'pending');

    fileListEl.innerHTML = uploadedFiles.map(f => `
      <div class="upload-file-item" data-id="${f.id}">
        <div class="upload-file-icon">
          ${f.status === 'complete' ? '✅' : f.status === 'error' ? '❌' : '🎵'}
        </div>
        <div class="upload-file-details">
          <div class="upload-file-name">${Logger.escapeHTML(f.name)}</div>
          <div class="upload-file-meta">
            <span>${f.sizeFormatted}</span>
            <span class="sep"></span>
            <span>${statusLabel(f.status)}</span>
          </div>
          ${f.status === 'uploading' ? `
            <div class="upload-progress">
              <div class="upload-progress-bar" style="width: ${Math.min(f.progress, 100)}%"></div>
            </div>
          ` : ''}
          ${f.status === 'complete' ? `
            <div class="upload-progress">
              <div class="upload-progress-bar complete" style="width: 100%"></div>
            </div>
          ` : ''}
        </div>
        ${f.status === 'pending' ? `
          <button class="upload-file-remove" onclick="Upload.removeFile(${f.id})" title="Hapus">✕</button>
        ` : ''}
      </div>
    `).join('');

    // Stats
    const total = uploadedFiles.length;
    const completed = uploadedFiles.filter(f => f.status === 'complete').length;
    const pending = uploadedFiles.filter(f => f.status === 'pending').length;
    const totalSize = uploadedFiles.reduce((sum, f) => sum + f.size, 0);

    if (total > 1) {
      statsEl.style.display = 'flex';
      statsEl.innerHTML = `
        <span class="upload-stat"><strong>${total}</strong> file</span>
        <span class="upload-stat"><strong>${formatSize(totalSize)}</strong> total</span>
        <span class="upload-stat"><strong>${completed}</strong> selesai</span>
        ${pending > 0 ? `<span class="upload-stat"><strong>${pending}</strong> menunggu</span>` : ''}
      `;
    } else {
      statsEl.style.display = 'none';
    }
  }

  function statusLabel(status) {
    switch (status) {
      case 'pending':   return 'Menunggu';
      case 'uploading': return 'Mengupload...';
      case 'complete':  return 'Selesai ✓';
      case 'error':     return 'Gagal';
      default:          return status;
    }
  }

  function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  return { init, removeFile, clearAll, deleteServerFile };
})();
