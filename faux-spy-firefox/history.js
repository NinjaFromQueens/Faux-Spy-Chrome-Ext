'use strict';

let allCases = [];
let activeFilter = 'all';

// ============================================================================
// INIT
// ============================================================================

async function init() {
  // Check Pro status first
  const { license } = await chrome.storage.local.get('license');
  if (!license?.isPro) {
    document.getElementById('proGate').classList.add('visible');
    return;
  }

  const { caseFiles } = await chrome.storage.local.get('caseFiles');
  allCases = caseFiles || [];

  updateCounts();
  renderCases();
  setupFilters();

  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear all case files? This cannot be undone.')) return;
    await chrome.storage.local.remove('caseFiles');
    allCases = [];
    updateCounts();
    renderCases();
  });
}

// ============================================================================
// RENDER
// ============================================================================

function renderCases() {
  const grid = document.getElementById('casesGrid');
  const emptyState = document.getElementById('emptyState');

  const filtered = filterCases(allCases, activeFilter);

  document.getElementById('entryCount').textContent =
    allCases.length === 1 ? '1 case' : `${allCases.length} cases`;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  grid.innerHTML = filtered.map(entry => buildCard(entry)).join('');
  grid.querySelectorAll('img.card-image').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      const ph = img.nextElementSibling;
      if (ph) ph.style.display = 'flex';
    });
  });
}

function filterCases(cases, filter) {
  if (filter === 'all') return cases;
  if (filter === 'ai') return cases.filter(c => c.isAI);
  if (filter === 'real') return cases.filter(c => !c.isAI && c.category !== 'inconclusive');
  if (filter === 'inconclusive') return cases.filter(c => c.category === 'inconclusive');
  return cases;
}

function buildCard(entry) {
  const cardClass = entry.isAI ? 'is-ai' : (entry.category === 'inconclusive' ? 'is-inconclusive' : 'is-real');
  const fillClass = entry.isAI ? 'ai' : (entry.category === 'inconclusive' ? 'inconclusive' : 'real');
  const timeAgo = formatTimeAgo(entry.timestamp);
  const domain = entry.domain || 'Unknown site';
  const safeUrl = entry.imageUrl ? entry.imageUrl.replace(/"/g, '%22') : '';
  const safeLabel = escapeHtml(entry.label || 'Unknown');
  const safeIcon = escapeHtml(entry.icon || '❓');
  const safeDomain = escapeHtml(domain);
  const safeTitle = escapeHtml(entry.pageTitle || domain);

  const imageHtml = safeUrl
    ? `<img class="card-image" src="${safeUrl}" alt="Scanned image" loading="lazy">
       <div class="card-image-placeholder" style="display:none;">🖼️</div>`
    : `<div class="card-image-placeholder">🖼️</div>`;

  return `
    <div class="case-card ${cardClass}" title="${safeTitle}">
      ${imageHtml}
      <div class="card-body">
        <div class="card-verdict">
          <span class="verdict-icon">${safeIcon}</span>
          <span class="verdict-label">${safeLabel}</span>
        </div>
        <div class="confidence-bar-wrap">
          <div class="confidence-label">
            <span>Confidence</span>
            <span>${entry.confidence}%</span>
          </div>
          <div class="confidence-bar">
            <div class="confidence-fill ${fillClass}" style="width:${entry.confidence}%"></div>
          </div>
        </div>
        <div class="card-meta">
          <span class="card-domain">🌐 ${safeDomain}</span>
          <span class="card-time">${timeAgo}</span>
        </div>
      </div>
    </div>
  `;
}

// ============================================================================
// FILTERS
// ============================================================================

function setupFilters() {
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderCases();
    });
  });
}

function updateCounts() {
  document.getElementById('countAll').textContent = allCases.length;
  document.getElementById('countAI').textContent = allCases.filter(c => c.isAI).length;
  document.getElementById('countReal').textContent = allCases.filter(c => !c.isAI && c.category !== 'inconclusive').length;
  document.getElementById('countInconclusive').textContent = allCases.filter(c => c.category === 'inconclusive').length;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTimeAgo(timestamp) {
  if (!timestamp) return '—';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ============================================================================
// START
// ============================================================================

document.addEventListener('DOMContentLoaded', init);
