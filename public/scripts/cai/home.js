import * as api from './api.js';
import { go } from './router.js';

const state = {
    characters: [],
    filter: '',
};

function escapeHtml(s) {
    return (s ?? '').toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatChatCount(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
}

function tagline(character) {
    const notes = character.creator_notes || character.creatorcomment || '';
    if (notes) return notes.split(/\r?\n/)[0].slice(0, 80);
    if (character.tags && character.tags.length) return character.tags.slice(0, 3).join(' · ');
    return character.personality?.slice(0, 80) || '';
}

function render() {
    const grid = document.getElementById('home-grid');
    if (!grid) return;
    const q = state.filter.toLowerCase().trim();
    const visible = q
        ? state.characters.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.creator || '').toLowerCase().includes(q) ||
            (c.tags || []).some(t => t.toLowerCase().includes(q)))
        : state.characters;

    if (!state.characters.length) {
        grid.innerHTML = `
            <div class="cai-setup-banner" style="grid-column: span 2;">
                No characters yet. Add character cards to <code>data/default-user/characters/</code>
                or visit <a href="/admin.html">the admin panel</a> to create or import them.
            </div>`;
        return;
    }

    if (!visible.length) {
        grid.innerHTML = `<div class="cai-empty" style="grid-column: span 2;">No matches for "${escapeHtml(state.filter)}"</div>`;
        return;
    }

    grid.innerHTML = visible.map(c => {
        const avatar = c.avatar ? api.getThumbnailUrl(c.avatar) : '';
        const creator = c.creator ? `@${escapeHtml(c.creator)}` : '';
        const chats = formatChatCount(c.chat_size || c.chat_count || c.chats || 0);
        return `
        <button class="cai-card" data-avatar="${escapeHtml(c.avatar || '')}">
            <div class="cai-card-image" style="${avatar ? `background-image: url('${avatar}')` : ''}"></div>
            <div class="cai-card-body">
                <div class="cai-card-name">${escapeHtml(c.name || 'Unnamed')}</div>
                <div class="cai-card-tag">${escapeHtml(tagline(c))}</div>
                <div class="cai-card-meta">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-12.5 6.7L3 21l2.3-5.5A8 8 0 1 1 21 12z"/></svg>
                    ${chats ? `${chats} ` : ''}${creator}
                </div>
            </div>
        </button>`;
    }).join('');

    grid.querySelectorAll('.cai-card').forEach(btn => {
        btn.addEventListener('click', () => {
            const avatar = btn.dataset.avatar;
            const character = state.characters.find(c => c.avatar === avatar);
            if (character) openCharacter(character);
        });
    });
}

function openCharacter(character) {
    go('chat', {
        avatarFile: character.avatar,
        character,
        fileName: null, // chat-view will resolve / create a chat file
    });
}

export async function refreshHome() {
    try {
        const all = await api.listCharacters();
        state.characters = Array.isArray(all) ? all : [];
        // Sort by chat count desc as a sensible default for "For You"
        state.characters.sort((a, b) =>
            (b.chat_size || b.chat_count || 0) - (a.chat_size || a.chat_count || 0));
        render();
    } catch (err) {
        console.error('[cai/home] failed to load characters', err);
    }
}

export function initHome() {
    const searchEl = document.getElementById('home-search');
    if (searchEl) searchEl.addEventListener('input', e => {
        state.filter = e.target.value;
        render();
    });

    document.querySelectorAll('.cai-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cai-tab').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    refreshHome();
}
