import * as api from './api.js';

const state = {
    character: null,
    fileName: null,
    config: null,
    store: null,
};

function escapeHtml(s) {
    return (s ?? '').toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function chatIdForActiveMode() {
    return state.config?.mode === 'isolated' ? state.fileName : null;
}

function renderMode() {
    const list = document.getElementById('memory-mode-list');
    if (!list) return;
    list.querySelectorAll('.cai-radio').forEach(el => {
        el.classList.toggle('selected', el.dataset.mode === state.config?.mode);
    });
}

function renderSwitch() {
    const sw = document.getElementById('memory-enable-switch');
    if (sw) sw.classList.toggle('on', !!state.config?.enabled);
}

function renderSummary() {
    const ta = document.getElementById('memory-summary');
    if (ta) ta.value = state.store?.summary || '';
}

function renderFacts() {
    const list = document.getElementById('memory-facts');
    if (!list) return;
    const facts = state.store?.facts || [];
    if (!facts.length) {
        list.innerHTML = '<li class="cai-empty" style="padding: 16px 0;">No facts stored yet.</li>';
        return;
    }
    list.innerHTML = facts.map(f => `
        <li class="cai-fact-item" data-id="${escapeHtml(f.id)}">
            <div class="cai-fact-content">
                ${escapeHtml(f.content)}
                <div class="cai-fact-imp">${escapeHtml(f.importance || 'medium')}</div>
            </div>
            <button class="cai-fact-del" aria-label="Delete fact">✕</button>
        </li>
    `).join('');
    list.querySelectorAll('.cai-fact-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.closest('.cai-fact-item').dataset.id;
            try {
                await api.memory.deleteFact(state.character.name, id, chatIdForActiveMode());
                await refreshStore();
            } catch (err) { console.error(err); }
        });
    });
}

async function refreshAll() {
    state.config = await api.memory.config(state.character.name);
    await refreshStore();
    renderMode();
    renderSwitch();
}

async function refreshStore() {
    const res = await api.memory.store(state.character.name, chatIdForActiveMode());
    state.store = res?.store ?? null;
    renderSummary();
    renderFacts();
}

export async function openMemorySheet({ character, fileName }) {
    if (!character) return;
    state.character = character;
    state.fileName = fileName;

    const backdrop = document.getElementById('memory-backdrop');
    const sheet = document.getElementById('memory-sheet');
    if (!backdrop || !sheet) return;
    backdrop.classList.add('open');
    sheet.classList.add('open');

    try { await refreshAll(); } catch (err) { console.error('[cai/memory] open failed', err); }
}

export function closeMemorySheet() {
    document.getElementById('memory-backdrop')?.classList.remove('open');
    document.getElementById('memory-sheet')?.classList.remove('open');
}

export function initMemory() {
    document.getElementById('memory-backdrop')?.addEventListener('click', closeMemorySheet);
    document.getElementById('memory-close')?.addEventListener('click', closeMemorySheet);

    document.getElementById('memory-enable-switch')?.addEventListener('click', async () => {
        if (!state.character) return;
        const next = !(state.config?.enabled);
        await api.memory.setConfig(state.character.name, { enabled: next });
        state.config.enabled = next;
        renderSwitch();
    });

    document.querySelectorAll('#memory-mode-list .cai-radio').forEach(el => {
        el.addEventListener('click', async () => {
            if (!state.character) return;
            const mode = el.dataset.mode;
            await api.memory.setConfig(state.character.name, { mode });
            state.config.mode = mode;
            renderMode();
            await refreshStore();
        });
    });

    const summary = document.getElementById('memory-summary');
    if (summary) {
        let debounce;
        summary.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(async () => {
                if (!state.character) return;
                try {
                    await api.memory.setSummary(
                        state.character.name,
                        summary.value,
                        chatIdForActiveMode());
                } catch (err) { console.warn(err); }
            }, 400);
        });
    }

    document.getElementById('memory-clear')?.addEventListener('click', async () => {
        if (!state.character) return;
        if (!confirm(`Clear memory for ${state.character.name}? This cannot be undone.`)) return;
        try {
            await api.memory.clear(state.character.name, chatIdForActiveMode());
            await refreshStore();
        } catch (err) { console.error(err); }
    });
}
