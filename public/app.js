/**
 * SpotiFLAC — Main App Entry Point
 * Orchestrates all modules and initializes the application.
 */

import { loadExtensions, performSearch } from './modules/search.js';
import { showView, showToast, updateGreeting, openExtensionManager } from './modules/ui.js';
import './modules/collection.js'; // loads module, registers window.__openCollection

// ── App Initialization ─────────────────────────────────────────

async function init() {
  updateGreeting();
  populateHomePage();

  const extensions = await loadExtensions();
  if (extensions.length === 0) {
    showToast('No extensions found. Install one in /extensions to start searching.', 'info', 5000);
  } else {
    const active = extensions.filter(e => !e.error);
    showToast(`${active.length} extension${active.length !== 1 ? 's' : ''} loaded`, 'success', 2500);
  }

  setupKeyboardShortcuts();
}

// ── Home Page ──────────────────────────────────────────────────

function populateHomePage() {
  const categories = [
    { name: 'Music', color: '#8D67AB' },
    { name: 'Podcasts', color: '#DC148C' },
    { name: 'Hip-Hop', color: '#BA5D07' },
    { name: 'Electronic', color: '#0D73EC' },
    { name: 'Rock', color: '#E8115B' },
    { name: 'Jazz', color: '#1E3264' },
    { name: 'Classical', color: '#477D95' },
    { name: 'Pop', color: '#148A08' },
    { name: 'R&B', color: '#E91429' },
    { name: 'Metal', color: '#3C3C3C' },
  ];

  const genresGrid = document.getElementById('genres-grid');
  if (genresGrid) {
    categories.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'category-card';
      card.style.background = cat.color;
      card.innerHTML = `<h3>${cat.name}</h3>`;
      card.addEventListener('click', () => {
        document.getElementById('search-input').value = cat.name;
        document.getElementById('search-input').dispatchEvent(new Event('input'));
        showView('search');
        performSearch(cat.name);
      });
      genresGrid.appendChild(card);
    });
  }

  const featuredGrid = document.getElementById('featured-grid');
  if (featuredGrid) {
    const featured = [
      { title: 'Lossless Quality', subtitle: 'FLAC audio at its finest — download and keep forever' },
      { title: 'FLAC Library', subtitle: 'Build your personal high-fidelity music collection' },
      { title: 'Extension Store', subtitle: 'Add search sources from different providers' },
    ];
    featured.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-art-placeholder">
          <svg viewBox="0 0 24 24" width="48" height="48" style="opacity:0.4">
            <path fill="currentColor" d="M9 3a1 1 0 0 0-1 1v10.185a3.5 3.5 0 1 0 2 3.115V9h8V6a3 3 0 0 0-3-3H9z"/>
          </svg>
        </div>
        <div class="card-title">${item.title}</div>
        <div class="card-subtitle">${item.subtitle}</div>
      `;
      featuredGrid.appendChild(card);
    });
  }
}

// ── Back / Forward Navigation ──────────────────────────────────

const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');

if (btnBack) {
  btnBack.disabled = false;
  btnBack.addEventListener('click', () => history.back());
}

if (btnForward) {
  btnForward.disabled = false;
  btnForward.addEventListener('click', () => history.forward());
}

// ── Keyboard Shortcuts ─────────────────────────────────────────

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    if (e.key === ' ' && !isInput) {
      e.preventDefault();
      import('./modules/player.js').then(({ togglePlay }) => togglePlay());
    }

    if ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const searchInput = document.getElementById('search-input');
      searchInput.focus();
      showView('search');
    }

    if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey) && !isInput) {
      import('./modules/player.js').then(({ playNext }) => playNext());
    }

    if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey) && !isInput) {
      import('./modules/player.js').then(({ playPrev }) => playPrev());
    }

    if (e.key === 'd' && (e.ctrlKey || e.metaKey) && !isInput) {
      e.preventDefault();
      import('./modules/player.js').then(({ downloadCurrentTrack }) => downloadCurrentTrack());
    }
  });
}

// ── Global Error Handler ───────────────────────────────────────

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});

// ── Run ────────────────────────────────────────────────────────

init();
