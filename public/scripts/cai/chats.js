import * as api from './api.js';
import { go } from './router.js';

const state = {
    characters: [],
    rows: [],   // [{ character, file, lastModified }]
    filter: '',
};

function escapeHtml(s) {
    return (s ?? '').toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildRows() {
    const rows = [];
    for (const ch of state.characters) {
        try {
            const chats = await api.listCharacterChats(ch.avatar);
            if (!Array.isArray(chats) || !chats.length) continue;
            // chats: [{ file_name, last_mes, mes, file_size, ... }]
            const latest = chats.reduce((a, b) =>
                (new Date(b.last_mes || 0)) > (new Date(a.last_mes || 0)) ? b : a, chats[0]);
            rows.push({
                character: ch,
                file: (latest.file_name || '').replace(/\.jsonl?$/i, ''),
                lastModified: new Date(latest.last_mes || 0).getTime(),
            });
        } catch (err) {
            // character has no chats yet — skip silently
        }
    }
    rows.sort((a, b) => b.lastModified - a.lastModified);
    return rows;
}

function render() {
    const list = document.getElementById('chats-list');
    if (!list) return;
    const q = state.filter.toLowerCase().trim();
    const visible = q
        ? state.rows.filter(r => (r.character.name || '').toLowerCase().includes(q))
        : state.rows;

    if (!visible.length) {
        list.innerHTML = `<div class="cai-empty">${state.rows.length ? 'No matches' : 'No conversations yet'}</div>`;
        return;
    }

    list.innerHTML = visible.map(r => {
        const avatar = r.character.avatar ? api.getThumbnailUrl(r.character.avatar) : '';
        return `
        <button class="cai-chat-row" data-avatar="${escapeHtml(r.character.avatar || '')}" data-file="${escapeHtml(r.file)}">
            <div class="cai-avatar" style="${avatar ? `background-image: url('${avatar}')` : ''}"></div>
            <div class="cai-chat-row-name">${escapeHtml(r.character.name || 'Unnamed')}</div>
        </button>`;
    }).join('');

    list.querySelectorAll('.cai-chat-row').forEach(btn => {
        btn.addEventListener('click', () => {
            const avatar = btn.dataset.avatar;
            const file = btn.dataset.file;
            const character = state.characters.find(c => c.avatar === avatar);
            if (character) {
                go('chat', { avatarFile: avatar, character, fileName: file });
            }
        });
    });
}

export async function refreshChats() {
    try {
        state.characters = await api.listCharacters();
        state.rows = await buildRows();
        render();
    } catch (err) {
        console.error('[cai/chats] refresh failed', err);
    }
}

export function initChats() {
    const search = document.getElementById('chats-search');
    if (search) search.addEventListener('input', e => {
        state.filter = e.target.value;
        render();
    });
}
