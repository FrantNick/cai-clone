// Thin wrapper around SillyTavern's REST endpoints + our memory endpoints.
// All non-GET calls go through fetchWithCsrf to include the x-csrf-token header
// that ST's csrf-sync middleware requires.

let csrfToken = null;
let userSettingsCache = null;

async function ensureCsrf() {
    if (csrfToken) return csrfToken;
    const r = await fetch('/csrf-token');
    const j = await r.json();
    csrfToken = j.token;
    return csrfToken;
}

export async function fetchWithCsrf(url, init = {}) {
    const token = await ensureCsrf();
    const headers = new Headers(init.headers || {});
    if (!headers.has('content-type') && init.body && typeof init.body === 'string') {
        headers.set('content-type', 'application/json');
    }
    headers.set('x-csrf-token', token);
    return fetch(url, { ...init, headers });
}

export async function postJson(url, body) {
    const r = await fetchWithCsrf(url, { method: 'POST', body: JSON.stringify(body ?? {}) });
    if (!r.ok) throw new Error(`POST ${url} → ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
}

export async function putJson(url, body) {
    const r = await fetchWithCsrf(url, { method: 'PUT', body: JSON.stringify(body ?? {}) });
    if (!r.ok) throw new Error(`PUT ${url} → ${r.status}`);
    return r.json();
}

export async function delJson(url) {
    const r = await fetchWithCsrf(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${url} → ${r.status}`);
    return r.json();
}

export async function getJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
    return r.json();
}

// --- Characters ---

export async function listCharacters() {
    const r = await fetchWithCsrf('/api/characters/all', {
        method: 'POST',
        body: JSON.stringify({}),
    });
    if (!r.ok) return [];
    return r.json();
}

export async function getCharacter(avatarUrl) {
    return postJson('/api/characters/get', { avatar_url: avatarUrl });
}

export async function listCharacterChats(avatarUrl) {
    const r = await fetchWithCsrf('/api/characters/chats', {
        method: 'POST',
        body: JSON.stringify({ avatar_url: avatarUrl, simple: true }),
    });
    if (!r.ok) return [];
    return r.json();
}

// --- Chats (messages on disk) ---

export async function loadChat(characterName, fileName) {
    const r = await fetchWithCsrf('/api/chats/get', {
        method: 'POST',
        body: JSON.stringify({
            ch_name: characterName,
            file_name: fileName.replace(/\.jsonl?$/i, ''),
            avatar_url: null,
        }),
    });
    if (!r.ok) return [];
    return r.json();
}

export async function saveChat(characterName, avatarUrl, fileName, chat) {
    return postJson('/api/chats/save', {
        ch_name: characterName,
        file_name: fileName.replace(/\.jsonl?$/i, ''),
        avatar_url: avatarUrl,
        chat,
        force: true,
    });
}

// --- Generation (Chat Completions) ---

export async function generateChatCompletion(payload, { signal } = {}) {
    return fetchWithCsrf('/api/backends/chat-completions/generate', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
    });
}

// --- Memory ---

export const memory = {
    async config(char) { return getJson(`/api/memory/${encodeURIComponent(char)}/config`); },
    async setConfig(char, patch) { return postJson(`/api/memory/${encodeURIComponent(char)}/config`, patch); },
    async store(char, chat) {
        const q = chat ? `?chat=${encodeURIComponent(chat)}` : '';
        return getJson(`/api/memory/${encodeURIComponent(char)}${q}`);
    },
    async preamble(char, chat) {
        const q = chat ? `?chat=${encodeURIComponent(chat)}` : '';
        return getJson(`/api/memory/${encodeURIComponent(char)}/preamble${q}`);
    },
    async addFacts(char, facts, chat) {
        return postJson(`/api/memory/${encodeURIComponent(char)}/facts`, { facts, chat });
    },
    async deleteFact(char, id, chat) {
        const q = chat ? `?chat=${encodeURIComponent(chat)}` : '';
        return delJson(`/api/memory/${encodeURIComponent(char)}/facts/${encodeURIComponent(id)}${q}`);
    },
    async setSummary(char, summary, chat) {
        return putJson(`/api/memory/${encodeURIComponent(char)}/summary`, { summary, chat });
    },
    async clear(char, chat) {
        return postJson(`/api/memory/${encodeURIComponent(char)}/clear`, { chat });
    },
    async extractionPrompt(payload) {
        return postJson(`/api/memory/extraction-prompt`, payload);
    },
    async summaryPrompt(payload) {
        return postJson(`/api/memory/summary-prompt`, payload);
    },
};

// --- User settings (so we can read the configured chat-completion source/model) ---

export async function getUserSettings() {
    if (userSettingsCache) return userSettingsCache;
    try {
        const r = await fetchWithCsrf('/api/settings/get', { method: 'POST', body: '{}' });
        if (!r.ok) return null;
        userSettingsCache = await r.json();
        return userSettingsCache;
    } catch (err) {
        console.warn('[cai/api] getUserSettings failed', err);
        return null;
    }
}

export function getAvatarUrl(avatarFile) {
    if (!avatarFile) return '';
    return `/characters/${encodeURIComponent(avatarFile)}`;
}

export function getThumbnailUrl(avatarFile) {
    if (!avatarFile) return '';
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatarFile)}`;
}
