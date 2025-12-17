/**
 * Semantic Relevance Demo - Browser Application
 * Uses the semantic-relevance library from src/
 */

import { fetchGitHub } from '../src/sources/github.js';
import { fetchHackerNews } from '../src/sources/hackernews.js';
import { fetchReddit } from '../src/sources/reddit.js';
import { fetchLobsters } from '../src/sources/lobsters.js';
import {
  filterItems,
  EmbeddingContext,
  NoveltyTracker,
  LocalStorageAdapter
} from '../src/signal/index.js';

// ============================================================
// Novelty Tracker (persistent across sessions)
// ============================================================
const noveltyStorage = new LocalStorageAdapter('semantic-relevance-novelty');
let noveltyTracker = null;

function getNoveltyTracker(halfLifeDays) {
  if (!noveltyTracker || noveltyTracker.halfLifeDays !== halfLifeDays) {
    noveltyTracker = new NoveltyTracker({
      storage: noveltyStorage,
      halfLifeDays: halfLifeDays
    });
  }
  return noveltyTracker;
}

// ============================================================
// DOM Elements
// ============================================================
const $ = (id) => document.getElementById(id);
const el = {
  context: $('context'),
  keywords: $('keywords'),
  subreddits: $('subreddits'),
  relevance: $('relevance'),
  relevanceValue: $('relevance-value'),
  maxItems: $('max-items'),
  maxItemsValue: $('max-items-value'),
  noveltyEnabled: $('novelty-enabled'),
  noveltyHalfLife: $('novelty-halflife'),
  noveltyHalfLifeValue: $('novelty-halflife-value'),
  noveltyStats: $('novelty-stats'),
  clearNovelty: $('clear-novelty'),
  fetchBtn: $('fetch-btn'),
  results: $('results'),
  stats: $('stats'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  themeToggle: $('theme-toggle'),
  srcGithub: $('src-github'),
  srcHackernews: $('src-hackernews'),
  srcReddit: $('src-reddit'),
  srcLobsters: $('src-lobsters')
};

// ============================================================
// Theme
// ============================================================
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

el.themeToggle?.addEventListener('click', () => {
  const newTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = newTheme;
  localStorage.setItem('theme', newTheme);
});

// ============================================================
// Collapsible Panels
// ============================================================
document.querySelectorAll('.panel-toggle').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('.collapsible-panel')?.classList.toggle('open'));
});

// On mobile, collapse all panels except Actions by default
function initMobilePanels() {
  if (window.innerWidth <= 768) {
    document.querySelectorAll('.collapsible-panel').forEach((panel) => {
      if (panel.dataset.panel !== 'actions') {
        panel.classList.remove('open');
      }
    });
  }
}
initMobilePanels();

// ============================================================
// Sliders
// ============================================================
el.relevance?.addEventListener('input', () => {
  if (el.relevanceValue) el.relevanceValue.textContent = el.relevance.value;
});
el.maxItems?.addEventListener('input', () => {
  if (el.maxItemsValue) el.maxItemsValue.textContent = el.maxItems.value;
});
el.noveltyHalfLife?.addEventListener('input', () => {
  if (el.noveltyHalfLifeValue) el.noveltyHalfLifeValue.textContent = el.noveltyHalfLife.value;
});

// ============================================================
// Novelty Controls
// ============================================================
function updateNoveltyStats() {
  if (!el.noveltyStats) return;
  const tracker = getNoveltyTracker(1);
  const stats = tracker.getStats();
  el.noveltyStats.textContent = `${stats.total} items tracked`;
}

el.clearNovelty?.addEventListener('click', async () => {
  if (confirm('Clear all novelty tracking data? Items will appear as "new" again.')) {
    await noveltyStorage.clear();
    noveltyTracker = null;
    updateNoveltyStats();
  }
});

// Initialize novelty stats on load
updateNoveltyStats();

// ============================================================
// Status
// ============================================================
function setStatus(state, text) {
  if (el.statusDot) el.statusDot.className = 'status-dot ' + state;
  if (el.statusText) el.statusText.textContent = text;
}

function showLoading(text, source = '') {
  if (!el.results) return;
  el.results.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span class="loading-text">${text}</span>
      ${source ? `<span class="loading-source">${source}</span>` : ''}
    </div>`;
}

// ============================================================
// Rendering
// ============================================================
function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}

function getNoveltyBadge(noveltyScore) {
  if (noveltyScore >= 0.9) return '<span class="novelty-badge new">NEW</span>';
  if (noveltyScore >= 0.5) return '<span class="novelty-badge recent">RECENT</span>';
  if (noveltyScore >= 0.2) return '<span class="novelty-badge seen">SEEN</span>';
  return '<span class="novelty-badge old">OLD</span>';
}

function renderSignals(signals, total, noveltyEnabled) {
  if (el.stats) el.stats.textContent = `${signals.length} signals from ${total} items`;
  if (!el.results) return;

  if (signals.length === 0) {
    el.results.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>No signals found matching your context</p>
        <p>Try lowering the relevance threshold</p>
      </div>`;
    return;
  }

  el.results.innerHTML = signals.map((s) => {
    const m = s.metadata || {};
    const fr = s.filter_result || {};
    const score = s.score || s.signalScore || 0;
    const recency = s.recencyLabel || '';
    const noveltyScore = fr.novelty_score || 100;

    return `
      <div class="signal-card ${noveltyScore < 50 ? 'seen-item' : ''}">
        <div class="signal-header">
          <span class="signal-type ${fr.signal_type || 'technical'}">${fr.signal_type || 'technical'}</span>
          <span class="signal-source">${s.source}</span>
          ${recency ? `<span class="signal-recency">${recency}</span>` : ''}
          ${noveltyEnabled ? getNoveltyBadge(noveltyScore / 100) : ''}
        </div>
        <div class="signal-title"><a href="${s.url}" target="_blank">${escapeHtml(s.title)}</a></div>
        ${s.description ? `<div class="signal-description">${escapeHtml(s.description.slice(0, 120))}...</div>` : ''}
        <div class="signal-meta">
          <span>Score: ${score} <div class="score-bar"><div class="score-fill" style="width:${score}%"></div></div></span>
          <span>Relevance: ${fr.relevance_score || 0}%</span>
          ${noveltyEnabled ? `<span>Novelty: ${noveltyScore}%</span>` : ''}
          ${m.stars ? `<span>&#11088; ${m.stars}</span>` : ''}
          ${m.points ? `<span>&#9650; ${m.points}</span>` : ''}
          ${m.score ? `<span>&#8593; ${m.score}</span>` : ''}
          ${m.comments ? `<span>&#128172; ${m.comments}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// Main Filter Logic (uses library's filterItems)
// ============================================================
async function fetchAndFilter() {
  const context = el.context?.value.trim() || '';
  const keywords = el.keywords?.value.split(',').map((k) => k.trim()).filter(Boolean) || [];
  const subreddits = el.subreddits?.value.split(',').map((s) => s.trim()).filter(Boolean) || [];
  const threshold = parseInt(el.relevance?.value || '30') / 100;
  const maxItems = parseInt(el.maxItems?.value || '50');
  const noveltyEnabled = el.noveltyEnabled?.checked ?? true;
  const noveltyHalfLife = parseFloat(el.noveltyHalfLife?.value || '1');

  if (!context) {
    if (el.results) el.results.innerHTML = `<div class="empty-state"><p>Please enter context first</p></div>`;
    return;
  }
  if (el.fetchBtn) el.fetchBtn.disabled = true;

  showLoading('Initializing...');

  try {
    // Pre-initialize embedding context with progress callback (for browser UX)
    setStatus('busy', 'Loading AI model');
    showLoading('Loading AI model...', 'First run downloads ~30MB');

    const embeddingCtx = new EmbeddingContext();
    await embeddingCtx.init({
      onProgress: (p) => {
        if (p.status === 'downloading') {
          const pct = Math.round((p.loaded / p.total) * 100);
          setStatus('busy', `Downloading ${pct}%`);
          showLoading('Downloading AI model...', `${pct}%`);
        }
      }
    });

    setStatus('ready', 'AI model ready');

    // Fetch from sources
    const allItems = [];

    if (el.srcGithub?.checked) {
      showLoading('Fetching sources...', 'Searching GitHub repositories');
      const items = await fetchGitHub({ keywords: keywords.slice(0, 3), maxItems: 20 });
      allItems.push(...items);
    }

    if (el.srcHackernews?.checked) {
      showLoading('Fetching sources...', 'Searching Hacker News');
      const items = await fetchHackerNews({ keywords: keywords.slice(0, 3), maxItems: 30 });
      allItems.push(...items);
    }

    if (el.srcReddit?.checked && subreddits.length) {
      showLoading('Fetching sources...', 'Searching Reddit');
      const items = await fetchReddit({ subreddits: subreddits.slice(0, 4), maxItems: 20 });
      allItems.push(...items);
    }

    if (el.srcLobsters?.checked) {
      showLoading('Fetching sources...', 'Searching Lobsters');
      const items = await fetchLobsters({ maxItems: 15 });
      allItems.push(...items);
    }

    showLoading('Analyzing relevance...', `Processing ${allItems.length} items`);

    // Initialize novelty tracker if enabled
    const tracker = noveltyEnabled ? getNoveltyTracker(noveltyHalfLife) : null;

    // Use the library's filterItems function
    const signals = await filterItems(allItems.slice(0, maxItems), context, {
      relevanceThreshold: threshold,
      noveltyThreshold: noveltyEnabled ? 0.0 : 0.5, // Show all if novelty display is on
      userKeywords: { global: keywords },
      noveltyTracker: tracker,
      embeddingContext: embeddingCtx // Pre-initialized for progress display
    });

    // Update novelty stats after filtering
    if (tracker) {
      updateNoveltyStats();
    }

    renderSignals(signals, allItems.length, noveltyEnabled);

  } catch (err) {
    console.error('Fetch error:', err);
    if (el.results) el.results.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
  } finally {
    if (el.fetchBtn) el.fetchBtn.disabled = false;
  }
}

// ============================================================
// State Persistence
// ============================================================
const saved = localStorage.getItem('semantic-relevance-state');
if (saved) {
  try {
    const s = JSON.parse(saved);
    if (s.context && el.context) el.context.value = s.context;
    if (s.keywords && el.keywords) el.keywords.value = s.keywords;
    if (s.subreddits && el.subreddits) el.subreddits.value = s.subreddits;
  } catch (e) {
    // ignore
  }
}

function saveState() {
  localStorage.setItem('semantic-relevance-state', JSON.stringify({
    context: el.context?.value || '',
    keywords: el.keywords?.value || '',
    subreddits: el.subreddits?.value || ''
  }));
}

el.context?.addEventListener('change', saveState);
el.keywords?.addEventListener('change', saveState);
el.subreddits?.addEventListener('change', saveState);

// ============================================================
// Init
// ============================================================
el.fetchBtn?.addEventListener('click', fetchAndFilter);
