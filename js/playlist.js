/**
 * playlist.js — Playlist Module
 * Allows users to create playlists and browse others' playlists.
 * When entering another user's playlist, the node context switches.
 */

const Playlist = (() => {
  let playlistListEl, playlistEmptyEl, playlistCountEl;
  let createBtn, createNameInput;
  let viewingPlaylist = null; // null = not viewing, otherwise playlist object
  /**
   * Inisialisasi awal untuk memuat daftar playlist.
   */

  function init() {
    playlistListEl  = document.getElementById('playlist-list');
    playlistEmptyEl = document.getElementById('playlist-empty');
    playlistCountEl = document.getElementById('playlist-count');
    createBtn       = document.getElementById('playlist-create-btn');
    createNameInput = document.getElementById('playlist-name-input');

    createBtn.addEventListener('click', createPlaylist);
    createNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createPlaylist();
      }
    });

    // Fetch playlists
    fetchPlaylists();
    setInterval(fetchPlaylists, 8_000);
  }

  let knownViewers = {}; // { playlistId: [viewerIds...] }

  // ==================== LIST PLAYLISTS ====================
  /**
   * Mengambil semua daftar playlist yang tersimpan di Server.
   */

  async function fetchPlaylists() {
    // Don't refresh if we're viewing a playlist detail
    if (viewingPlaylist) return;

    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/playlists`);
      if (!res.ok) return;
      const data = await res.json();
      renderPlaylists(data.playlists || []);
    } catch (e) {
      // Silently fail
    }
  }
  /**
   * Menggambar kartu-kartu playlist ke layar berdasarkan data dari Server.
   */

  function renderPlaylists(playlists) {
    playlistCountEl.textContent = playlists.length + ' Playlist' + (playlists.length !== 1 ? 's' : '');

    if (playlists.length === 0) {
      playlistEmptyEl.style.display = 'block';
      const items = playlistListEl.querySelectorAll('.playlist-item');
      items.forEach(i => i.remove());
      return;
    }

    playlistEmptyEl.style.display = 'none';
    const myNode = window.AppConfig.NODE_ID;

    let html = '';
    playlists.forEach(pl => {
      const isMine = pl.ownerNodeId === myNode;

      // Track viewers to notify owner
      if (isMine && pl.viewers) {
        if (!knownViewers[pl.id]) knownViewers[pl.id] = [];
        pl.viewers.forEach(v => {
          if (v !== myNode && !knownViewers[pl.id].includes(v)) {
            Logger.append(`${v} telah membuka playlist Anda "${pl.name}"`, 'success');
            knownViewers[pl.id].push(v);
          }
        });
        // Remove expired viewers from tracking
        knownViewers[pl.id] = knownViewers[pl.id].filter(v => pl.viewers.includes(v));
      }

      const ownerLabel = isMine ? `${pl.ownerNodeId} (Anda)` : pl.ownerNodeId;
      const bgColor = isMine ? '#E8F5E9' : '#EBF5FF';

      html += `
        <div class="playlist-item" style="background: ${bgColor};" onclick="Playlist.openPlaylist('${pl.id}')">
          <div class="playlist-item-icon">${isMine ? '📁' : '🎧'}</div>
          <div class="playlist-item-info">
            <div class="playlist-item-name">${Logger.escapeHTML(pl.name)}</div>
            <div class="playlist-item-meta">
              <span>${ownerLabel}</span>
              <span>•</span>
              <span>${pl.songCount} lagu</span>
            </div>
          </div>
          <div class="playlist-item-arrow">→</div>
        </div>
      `;
    });

    const items = playlistListEl.querySelectorAll('.playlist-item');
    items.forEach(i => i.remove());
    // Also remove any playlist-detail-view
    const detailView = playlistListEl.querySelector('.playlist-detail-view');
    if (detailView) detailView.remove();

    playlistListEl.insertAdjacentHTML('beforeend', html);
  }

  // ==================== CREATE PLAYLIST ====================
  /**
   * Mengirim perintah ke Server untuk membuat Playlist baru.
   */

  async function createPlaylist() {
    const name = createNameInput.value.trim();
    if (!name) {
      Logger.append('Masukkan nama playlist.', 'warning');
      createNameInput.focus();
      return;
    }

    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/playlist/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          nodeId: window.AppConfig.NODE_ID
        })
      });

      if (res.ok) {
        const data = await res.json();
        Logger.append(`Playlist "${name}" berhasil dibuat! (${data.playlistId})`, 'success');
        createNameInput.value = '';
        fetchPlaylists();
      } else {
        Logger.append('Gagal membuat playlist.', 'error');
      }
    } catch (e) {
      Logger.append(`Error: ${e.message}`, 'error');
    }
  }

  // ==================== OPEN/VIEW PLAYLIST ====================

  async function openPlaylist(playlistId, isRefresh = false) {
    try {
      // Send our nodeId as viewer
      const myNode = window.AppConfig.NODE_ID;
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/playlist/songs?id=${playlistId}&viewerId=${myNode}`);
      if (!res.ok) {
        if (!isRefresh) Logger.append('Playlist tidak ditemukan.', 'error');
        return;
      }
      const pl = await res.json();
      viewingPlaylist = pl;

      const isMine = pl.ownerNodeId === myNode;

      if (!isRefresh) {
        if (!isMine) {
          Logger.append(`Memasuki playlist "${pl.name}" milik ${pl.ownerNodeId} — berpindah node...`, 'info');
        } else {
          Logger.append(`Membuka playlist Anda: "${pl.name}"`, 'info');
        }
        renderPlaylistDetail(pl, isMine);
      } else {
        updatePlaylistDetail(pl);
      }
    } catch (e) {
      if (!isRefresh) Logger.append(`Error: ${e.message}`, 'error');
    }
  }

  // Poll current playlist every 5 seconds to update viewers & songs
  setInterval(() => {
    if (viewingPlaylist) {
      openPlaylist(viewingPlaylist.id, true);
    }
  }, 5000);
  /**
   * Menampilkan daftar lagu apa saja yang ada di dalam sebuah Playlist.
   */

  function renderPlaylistDetail(pl, isMine) {
    const myNode = window.AppConfig.NODE_ID;

    // Update header to show node switch
    const titleEl = document.getElementById('node-title');
    const statusText = document.getElementById('status-text');

    if (!isMine) {
      titleEl.textContent = `🎧 Viewing ${pl.ownerNodeId}'s Playlist`;
      titleEl.style.color = '#3A86FF';
      if (statusText) statusText.textContent = `Terhubung ke ${pl.ownerNodeId} — Playlist Mode`;
    }

    // Clear list and show detail view
    const items = playlistListEl.querySelectorAll('.playlist-item');
    items.forEach(i => i.style.display = 'none');
    playlistEmptyEl.style.display = 'none';

    // Remove old detail view if any
    const oldDetail = playlistListEl.querySelector('.playlist-detail-view');
    if (oldDetail) oldDetail.remove();

    let songsHtml = '';
    if (pl.songs.length === 0) {
      songsHtml = `
        <div class="playlist-detail-empty">
          <div>🎵</div>
          <div>Playlist ini masih kosong</div>
        </div>
      `;
    } else {
      pl.songs.forEach((song, idx) => {
        const esc = Logger.escapeHTML(song.filename);
        songsHtml += `
          <div class="playlist-song-item">
            <span class="playlist-song-num">${idx + 1}</span>
            <span class="playlist-song-name">${esc}</span>
            <div class="playlist-song-actions">
              ${song.existsOnServer ? `
                <button class="neo-btn-play-sm" onclick="Player.play('${esc}', '${Logger.escapeHTML(pl.ownerNodeId)}')">▶</button>
              ` : '<span style="font-size:0.7rem;color:#999;">Tidak tersedia</span>'}
              ${isMine ? `
                <button class="playlist-song-remove" onclick="Playlist.removeSong('${pl.id}', '${esc}')" title="Hapus">✕</button>
              ` : ''}
            </div>
          </div>
        `;
      });
    }

    // Add song input if it's mine
    const addSongHtml = isMine ? `
      <div class="playlist-add-song">
        <input type="text" class="neo-input playlist-add-input" id="add-song-input-${pl.id}" list="available-songs-list" placeholder="Ketik nama file lagu..." autocomplete="off" />
        <datalist id="available-songs-list"></datalist>
        <button class="neo-btn neo-btn-sm neo-btn-primary" onclick="Playlist.addSong('${pl.id}')">+ Tambah</button>
      </div>
    ` : '';

    const detailHtml = `
      <div class="playlist-detail-view">
        <div class="playlist-detail-header">
          <button class="playlist-back-btn" onclick="Playlist.goBack()">← Kembali</button>
          <div class="playlist-detail-title">
            <strong>${Logger.escapeHTML(pl.name)}</strong>
            <span class="playlist-detail-owner">oleh ${Logger.escapeHTML(pl.ownerNodeId)}${isMine ? ' (Anda)' : ''} • ${pl.songs.length} lagu</span>
            <div id="playlist-viewers-list" style="font-size: 0.75rem; margin-top: 4px; color: #666;">
              👁️ Active Viewers: ${pl.viewers && pl.viewers.length > 0 ? pl.viewers.map(v => Logger.escapeHTML(v)).join(', ') : '-'}
            </div>
          </div>
        </div>
        ${addSongHtml}
        <div class="playlist-songs-list" id="playlist-songs-list-container">
          ${songsHtml}
        </div>
      </div>
    `;

    playlistListEl.insertAdjacentHTML('beforeend', detailHtml);

    // Populate datalist if it's mine
    if (isMine) {
      populateSongOptions();
    }
  }

  function updatePlaylistDetail(pl) {
    const viewersEl = document.getElementById('playlist-viewers-list');
    if (viewersEl) {
      viewersEl.innerHTML = `👁️ Active Viewers: ${pl.viewers && pl.viewers.length > 0 ? pl.viewers.map(v => Logger.escapeHTML(v)).join(', ') : '-'}`;
    }

    const songsContainer = document.getElementById('playlist-songs-list-container');
    if (songsContainer) {
      const myNode = window.AppConfig.NODE_ID;
      const isMine = pl.ownerNodeId === myNode;
      let songsHtml = '';
      if (pl.songs.length === 0) {
        songsHtml = `
          <div class="playlist-detail-empty">
            <div>🎵</div>
            <div>Playlist ini masih kosong</div>
          </div>
        `;
      } else {
        pl.songs.forEach((song, idx) => {
          const esc = Logger.escapeHTML(song.filename);
          songsHtml += `
            <div class="playlist-song-item">
              <span class="playlist-song-num">${idx + 1}</span>
              <span class="playlist-song-name">${esc}</span>
              <div class="playlist-song-actions">
                ${song.existsOnServer ? `
                  <button class="neo-btn-play-sm" onclick="Player.play('${esc}', '${Logger.escapeHTML(pl.ownerNodeId)}')">▶</button>
                ` : '<span style="font-size:0.7rem;color:#999;">Tidak tersedia</span>'}
                ${isMine ? `
                  <button class="playlist-song-remove" onclick="Playlist.removeSong('${pl.id}', '${esc}')" title="Hapus">✕</button>
                ` : ''}
              </div>
            </div>
          `;
        });
      }
      songsContainer.innerHTML = songsHtml;
    }
  }


  async function populateSongOptions() {
    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/list_files`);
      if (res.ok) {
        const data = await res.json();
        const datalist = document.getElementById('available-songs-list');
        if (datalist && data.files) {
          datalist.innerHTML = data.files.map(f => `<option value="${Logger.escapeHTML(f.name)}">`).join('');
        }
      }
    } catch (e) {
      console.error('Failed to load songs for datalist:', e);
    }
  }

  // ==================== ADD / REMOVE SONGS ====================

  async function addSong(playlistId) {
    const input = document.getElementById(`add-song-input-${playlistId}`);
    const filename = input ? input.value.trim() : '';
    if (!filename) {
      Logger.append('Masukkan nama file lagu.', 'warning');
      return;
    }

    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/playlist/add_song`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId, filename })
      });

      if (res.ok) {
        Logger.append(`"${filename}" ditambahkan ke playlist.`, 'success');
        input.value = '';
        openPlaylist(playlistId); // refresh view
      }
    } catch (e) {
      Logger.append(`Error: ${e.message}`, 'error');
    }
  }

  async function removeSong(playlistId, filename) {
    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/playlist/remove_song`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId, filename })
      });

      if (res.ok) {
        Logger.append(`"${filename}" dihapus dari playlist.`, 'warning');
        openPlaylist(playlistId); // refresh view
      }
    } catch (e) {
      Logger.append(`Error: ${e.message}`, 'error');
    }
  }

  // ==================== GO BACK ====================

  function goBack() {
    viewingPlaylist = null;

    // Restore header
    const titleEl = document.getElementById('node-title');
    titleEl.textContent = window.AppConfig.NODE_ID + ': Music Vault';
    titleEl.style.color = '';

    // Remove detail view and show playlist items again
    const detailView = playlistListEl.querySelector('.playlist-detail-view');
    if (detailView) detailView.remove();

    const items = playlistListEl.querySelectorAll('.playlist-item');
    items.forEach(i => i.style.display = '');

    Logger.append('Kembali ke node Anda.', 'info');
    fetchPlaylists();
  }

  return { init, openPlaylist, addSong, removeSong, goBack };
})();
