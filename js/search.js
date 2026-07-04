/**
 * search.js — Search & Results Table Module
 * Handles fuzzy file search across the P2P network via Indexing Server.
 */

const Search = (() => {
  // ---- DOM References (lazy-init) ----
  let searchInput, resultsBody, resultsCount, emptyState;

  function init() {
    searchInput  = document.getElementById('search-input');
    resultsBody  = document.getElementById('results-body');
    resultsCount = document.getElementById('results-count');
    emptyState   = document.getElementById('empty-state');

    // Enter key support
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch();
      }
    });
  }

  /** Execute search from the input field. */
  function handleSearch() {
    const filename = searchInput.value.trim();
    if (!filename) {
      Logger.append('Error: Masukkan kata kunci untuk mencari.', 'error');
      searchInput.focus();
      return;
    }
    searchFile(filename);
  }

  /** Quick search by clicking a chip. */
  function quickSearch(filename) {
    searchInput.value = filename;
    handleSearch();
  }

  /** Core search logic — Fuzzy search via Indexing Server */
  async function searchFile(keyword) {
    const esc = Logger.escapeHTML;
    Logger.append(`Mencari "${keyword}" di jaringan (fuzzy search)...`, 'info');

    try {
      const response = await fetch(`${window.AppConfig.BACKEND_URL}/search?filename=${encodeURIComponent(keyword)}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      // Flatten: each result has filename + nodes array → one row per node
      const rows = [];
      results.forEach(r => {
        r.nodes.forEach(nodeId => {
          rows.push({
            filename: r.filename,
            nodeId: nodeId,
            existsOnServer: r.existsOnServer
          });
        });
      });

      if (rows.length > 0) {
        Logger.append(`Ditemukan ${results.length} file, ${rows.length} sumber untuk "${keyword}".`, 'success');

        resultsBody.innerHTML = '';
        emptyState.style.display = 'none';
        resultsCount.textContent = `${rows.length} Result${rows.length > 1 ? 's' : ''}`;

        const colors = ['#3A86FF', '#FF6B9D', '#00E676', '#FF9F43', '#A855F7', '#FF3D57'];

        rows.forEach((r, idx) => {
          setTimeout(() => {
            Logger.append(`  → "${r.filename}" tersedia di ${r.nodeId}`, 'success');

            const color = colors[idx % colors.length];
            const row = document.createElement('tr');
            row.innerHTML = `
              <td>
                <div class="file-info">
                  <span class="file-icon">🎵</span>
                  <div>
                    <div class="file-name">${esc(r.filename)}</div>
                    <div class="file-size">${r.existsOnServer ? '📁 Ada di server' : '🔗 Index only'}</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="node-tag">
                  <span class="node-dot" style="background:${color}"></span>
                  ${esc(r.nodeId)}
                </span>
              </td>
              <td>${r.existsOnServer ? '✅' : '—'}</td>
              <td>
                <div class="actions-cell">
                  <button class="neo-btn neo-btn-stream" onclick="Player.play('${esc(r.filename)}', '${esc(r.nodeId)}')">
                    ▶ Stream
                  </button>
                </div>
              </td>
            `;
            resultsBody.appendChild(row);
          }, idx * 80);
        });
      } else {
        Logger.append(`Tidak ditemukan hasil untuk "${keyword}".`, 'warning');
        resultsBody.innerHTML = '';
        emptyState.style.display = 'block';
        resultsCount.textContent = '0 Results';
        emptyState.querySelector('.empty-state-text').textContent = `"${keyword}" tidak ditemukan`;
        emptyState.querySelector('.empty-state-sub').textContent = 'Coba kata kunci lain (misal: "tegar", "naff", "remix")';
      }
    } catch (error) {
      Logger.append(`Error gagal menghubungi server: ${error.message}`, 'error');
    }
  }

  return { init, handleSearch, quickSearch };
})();
