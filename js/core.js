/**
 * logger.js — System Log / Terminal Console Module
 * Handles all log output to the terminal-style console.
 */

// Global Configuration — Node ID unik per device (disimpan di localStorage)
(function() {
  let nodeId = localStorage.getItem('musshare_node_id');
  if (!nodeId) {
    // Generate ID unik: "Node-" + 2 digit angka (01-99)
    const num = Math.floor(Math.random() * 99) + 1;
    nodeId = 'Node-' + String(num).padStart(2, '0');
    localStorage.setItem('musshare_node_id', nodeId);
  }

  const hostname = window.location.hostname || "localhost";
  window.AppConfig = {
    BACKEND_URL: `http://${hostname}:8081`,
    NODE_ID: nodeId
  };

  // Update header title dengan Node ID device ini
  document.addEventListener('DOMContentLoaded', () => {
    const titleEl = document.getElementById('node-title');
    if (titleEl) titleEl.textContent = nodeId + ': Music Vault';
  });
})();

const Logger = (() => {
  let logBody = null;
  /**
   * Menginisialisasi Node P2P saat web pertama kali dimuat.
   * Membaca/membuat Node-ID, menyiapkan UI, dan menjalankan detak jantung (ping).
   */

  function init() {
    logBody = document.getElementById('log-body');
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function append(message, type = '') {
    if (!logBody) init();

    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', { hour12: false });
    
    // Tambahkan prefix Node ID jika sudah tersedia
    let nodePrefix = '';
    if (window.AppConfig && window.AppConfig.NODE_ID) {
      nodePrefix = `[${window.AppConfig.NODE_ID}] `;
    }

    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `
      <span class="log-time">[${time}]</span>
      <span class="log-prefix">${nodePrefix}SYS&gt;</span>
      <span class="log-msg ${type}">${escapeHTML(message)}</span>
    `;
    logBody.appendChild(line);
    logBody.scrollTop = logBody.scrollHeight;
  }

  function clear() {
    if (!logBody) init();
    logBody.innerHTML = '';
    append('Log cleared.', 'info');
  }

  /** Boot sequence with staggered messages — now pings real server. */
  function bootSequence() {
    const backendUrl = window.AppConfig.BACKEND_URL;
    const nodeId = window.AppConfig.NODE_ID;

    append('Initializing P2P Music Network Node...', 'info');

    setTimeout(() => append(`Node ID: ${nodeId}`, 'success'), 300);
    setTimeout(() => append(`Connecting to Indexing Server at ${backendUrl}...`, ''), 600);

    // Actually ping the server
    setTimeout(async () => {
      try {
        const start = performance.now();
        const res = await fetch(`${backendUrl}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId })
        });
        const latency = Math.round(performance.now() - start);

        if (res.ok) {
          append(`Handshake successful. Latency: ${latency}ms`, 'success');
          append('Syncing file index with Indexing Server...', '');

          // Fetch initial stats
          setTimeout(async () => {
            try {
              const statsRes = await fetch(`${backendUrl}/stats`);
              const stats = await statsRes.json();
              append(`File index synchronized. ${stats.totalFiles} files indexed, ${stats.activePeers} peer(s) online.`, 'success');
              append('Ready. Awaiting commands.', 'success');
            } catch (e) {
              append('Warning: Gagal mengambil stats awal.', 'warning');
              append('Ready. Awaiting commands.', 'success');
            }
          }, 400);
        } else {
          append('Koneksi gagal: Server merespons dengan error.', 'error');
        }
      } catch (e) {
        append(`Koneksi gagal: ${e.message}`, 'error');
        append('Mode offline — fitur terbatas.', 'warning');
      }
    }, 900);
  }

  return { init, append, clear, bootSequence, escapeHTML };
})();

/**
 * player.js — Audio Player Module
 * Handles playback UI and audio element control.
 */

const Player = (() => {
  let audioPlayer, audioSource, trackName, trackSource, vinyl, playerStatus;
  let audioCtx, analyser, dataArray, canvasCtx, canvas;
  let animFrameId = null;
  let audioCtxInitialized = false;

  function init() {
    audioPlayer   = document.getElementById('audio-player');
    audioSource   = document.getElementById('audio-source');
    trackName     = document.getElementById('track-name');
    trackSource   = document.getElementById('track-source');
    vinyl         = document.getElementById('album-art');
    playerStatus  = document.getElementById('player-status');
    canvas        = document.getElementById('visualizer-canvas');
    canvasCtx     = canvas.getContext('2d');

    audioPlayer.addEventListener('play', () => {
      vinyl.classList.add('playing');
      playerStatus.textContent = 'Playing';
      playerStatus.style.background = '#1a3a1a';
      playerStatus.style.color = '#00E676';
      playerStatus.style.borderColor = '#00E676';
      initAudioContext();
      drawVisualizer();
    });

    audioPlayer.addEventListener('pause', () => {
      vinyl.classList.remove('playing');
      playerStatus.textContent = 'Paused';
      playerStatus.style.background = '#3a3a1a';
      playerStatus.style.color = '#FFBD2E';
      playerStatus.style.borderColor = '#FFBD2E';
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = null;
    });

    audioPlayer.addEventListener('ended', () => {
      vinyl.classList.remove('playing');
      playerStatus.textContent = 'Ended';
      playerStatus.style.background = '#222';
      playerStatus.style.color = '#8b949e';
      playerStatus.style.borderColor = '#333';
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = null;
      drawIdleBars();
      Logger.append('Playback selesai.', 'info');
    });

    // Draw idle bars on load
    drawIdleBars();
  }

  /** Initialize Web Audio API context and connect analyser (once). */
  /**
   * Menginisialisasi Web Audio API untuk membuat visualizer (animasi grafik suara).
   */
  function initAudioContext() {
    if (audioCtxInitialized) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      const source = audioCtx.createMediaElementSource(audioPlayer);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      audioCtxInitialized = true;
    } catch (e) {
      console.warn('Web Audio API connection failed, using simulated visualizer:', e);
      // Fallback: create fake dataArray for simulated visualizer
      analyser = null;
      dataArray = new Uint8Array(64);
      audioCtxInitialized = true;
    }
  }

  /** Draw the real-time frequency histogram. */
  /**
   * Menggambar (render) grafik frekuensi audio yang merespons musik secara real-time ke atas canvas.
   */
  function drawVisualizer() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    let tick = 0;

    function render() {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(render);
      tick++;

      // Get frequency data: real analyser or simulated
      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Simulated visualizer: bouncing bars based on time
        for (let i = 0; i < dataArray.length; i++) {
          const base = 100 + Math.sin(tick * 0.06 + i * 0.5) * 80;
          const noise = Math.random() * 60;
          dataArray[i] = Math.min(255, Math.max(0, base + noise));
        }
      }

      canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

      const barCount = 32;
      const barWidth = (WIDTH / barCount) - 2;
      let x = 1;

      for (let i = 0; i < barCount; i++) {
        const v = dataArray[i] / 255;
        const barHeight = v * HEIGHT * 0.92;

        // Gradient color: yellow → orange → red based on intensity
        const hue = 50 - (v * 40);
        const saturation = 90 + v * 10;
        const lightness = 50 + v * 10;
        canvasCtx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

        const radius = Math.min(barWidth / 2, 3);
        const bx = x;
        const by = HEIGHT - barHeight;
        const bw = barWidth;
        const bh = barHeight;

        canvasCtx.beginPath();
        canvasCtx.moveTo(bx + radius, by);
        canvasCtx.lineTo(bx + bw - radius, by);
        canvasCtx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
        canvasCtx.lineTo(bx + bw, by + bh);
        canvasCtx.lineTo(bx, by + bh);
        canvasCtx.lineTo(bx, by + radius);
        canvasCtx.quadraticCurveTo(bx, by, bx + radius, by);
        canvasCtx.fill();

        x += barWidth + 2;
      }
    }

    render();
  }

  /** Draw idle / static bars when no music is playing. */
  /**
   * Menampilkan grafik statis saat tidak ada musik yang sedang diputar.
   */
  function drawIdleBars() {
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;
    canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

    const barCount = 32;
    const barWidth = (WIDTH / barCount) - 2;
    let x = 1;

    for (let i = 0; i < barCount; i++) {
      const h = 4 + Math.sin(i * 0.4) * 3;
      canvasCtx.fillStyle = '#2a2a2a';
      canvasCtx.fillRect(x, HEIGHT - h, barWidth, h);
      x += barWidth + 2;
    }
  }

  let currentPlayingFile = null;

  /**
   * Play audio from a node.
   * @param {string} filename - File name to play.
   * @param {string} nodeId   - Node ID that holds the file.
   * @param {string} [objectUrl] - Optional blob URL for locally uploaded files.
   */
  /**
   * Memutar lagu dari server. Fungsi ini yang dipanggil saat pengguna menekan tombol Play.
   * Menangani antarmuka player (album art berputar, judul, streaming status).
   */
  function play(filename, nodeId, objectUrl) {
    if (currentPlayingFile === filename) {
      if (!audioPlayer.paused) {
        audioPlayer.pause();
      } else {
        audioPlayer.play().catch(e => console.warn(e));
      }
      return;
    }
    currentPlayingFile = filename;

    Logger.append(`Meminta file "${filename}" dari ${nodeId}...`, 'info');

    setTimeout(() => {
      Logger.append(`Establishing P2P stream with ${nodeId}...`, '');
    }, 300);

    setTimeout(() => {
      // Truncate long titles: keep first 4 words + "..."
      function truncateTitle(name, maxWords) {
        const words = name.split(/[\s_-]+/).filter(Boolean);
        if (words.length <= maxWords) return name;
        return words.slice(0, maxWords).join(' ') + '...';
      }

      const shortTitle = truncateTitle(filename, 4);

      // Update player UI in both inline card and bottom bar
      trackName.textContent = shortTitle;
      trackName.title = filename; // full title on hover
      trackSource.textContent = `Streaming dari ${nodeId}`;
      document.getElementById('bar-track-name').textContent = shortTitle;
      document.getElementById('bar-track-name').title = filename;
      document.getElementById('bar-track-node').textContent = nodeId;
      playerStatus.textContent = 'Streaming';
      playerStatus.style.background = '#1a3a1a';
      playerStatus.style.color = '#00E676';
      playerStatus.style.borderColor = '#00E676';
      vinyl.classList.add('playing');

      if (objectUrl) {
        audioSource.src = objectUrl;
      } else {
        audioSource.src = `${window.AppConfig.BACKEND_URL}/music/${encodeURIComponent(filename)}`;
      }
      audioPlayer.load();
      audioPlayer.play().catch(() => {
        Logger.append('Klik tombol play pada audio player.', 'warning');
      });

      Logger.append(`Memutar "${filename}" dari ${nodeId}.`, 'success');
    }, 700);
  }

  return { init, play };
})();

/**
 * stats.js — Network Stats Module
 * Periodically fetches real stats from the Indexing Server.
 */

const Stats = (() => {
  let statPeers, statFiles, statLatency;
  let heartbeatInterval, statsInterval;

  function init() {
    statPeers   = document.getElementById('stat-peers');
    statFiles   = document.getElementById('stat-files');
    statLatency = document.getElementById('stat-latency');

    // Send heartbeat every 10 seconds
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, 10_000);

    // Fetch stats every 5 seconds
    fetchStats();
    statsInterval = setInterval(fetchStats, 5_000);
  }
  /**
   * Mengirim sinyal 'ping' atau heartbeat ke server secara berkala.
   * Memberi tahu server bahwa Node browser ini sedang menyala dan aktif.
   */

  async function sendHeartbeat() {
    try {
      const start = performance.now();
      await fetch(`${window.AppConfig.BACKEND_URL}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: window.AppConfig.NODE_ID })
      });
      const latency = Math.round(performance.now() - start);

      // Update latency display with real value
      if (statLatency) {
        statLatency.textContent = latency + 'ms';
      }
    } catch (e) {
      // Silently fail — stats will show stale data
    }
  }
  /**
   * Mengambil data statistik terbaru (seperti latency, jumlah peer) dari server untuk diperbarui di UI.
   */

  async function fetchStats() {
    try {
      const res = await fetch(`${window.AppConfig.BACKEND_URL}/stats`);
      if (!res.ok) return;

      const data = await res.json();

      if (statPeers) statPeers.textContent = data.activePeers || 0;
      if (statFiles) {
        statFiles.textContent = data.totalFiles || 0;
      }

      // Update status badge based on connection
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      if (statusDot && statusText) {
        statusDot.style.background = '#00E676';
        statusText.textContent = `Connected — ${data.activePeers} Peer(s) Online`;
      }
    } catch (e) {
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      if (statusDot && statusText) {
        statusDot.style.background = '#FF3D57';
        statusText.textContent = 'Disconnected';
      }
    }
  }

  return { init };
})();

/**
 * app.js — Main Application Entry Point
 * Initializes all modules on DOMContentLoaded.
 */

document.addEventListener('DOMContentLoaded', () => {
  Logger.init();
  Search.init();
  Player.init();
  Upload.init();
  Stats.init();
  Playlist.init();

  Logger.bootSequence();
});
