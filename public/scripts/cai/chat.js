import * as api from './api.js';
import { onRouteChange, getChatContext } from './router.js';
import { openMemorySheet } from './memory.js';

const state = {
    character: null,        // full character object
    avatarFile: null,
    fileName: null,         // chat file (without extension)
    chat: [],               // ST chat message array
    pendingAbort: null,
    settingsCache: null,
};

const USER_NAME_FALLBACK = 'User';
const MESSAGES_SINCE_LAST_EXTRACTION_KEY = 'cai:lastExtractionMessageCount';

function escapeHtml(s) {
    return (s ?? '').toString()
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(120, textarea.scrollHeight) + 'px';
}

function todayChatFileName() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}@${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}m${String(d.getSeconds()).padStart(2, '0')}s`;
}

function renderHeader() {
    const titleEl = document.getElementById('chat-title');
    const avatarEl = document.getElementById('chat-avatar');
    const creditEl = document.getElementById('chat-author-credit');
    if (!state.character) return;
    titleEl.textContent = state.character.name || 'Character';
    avatarEl.style.backgroundImage = state.character.avatar
        ? `url('${api.getThumbnailUrl(state.character.avatar)}')`
        : '';
    if (creditEl) {
        const author = state.character.creator || '';
        creditEl.textContent = author
            ? `${state.character.name} was authored by @${author}`
            : '';
    }
}

function renderMessages() {
    const wrap = document.getElementById('chat-messages');
    if (!wrap) return;
    if (!state.chat.length) {
        wrap.innerHTML = '<div class="cai-empty">Say hi to start the conversation.</div>';
        return;
    }
    wrap.innerHTML = state.chat.map((m, idx) => {
        const isUser = !!m.is_user;
        const text = (m.mes ?? '').toString();
        const cls = isUser ? 'cai-msg-user' : 'cai-msg-char';
        const meta = (!isUser && idx === firstCharIndex())
            ? `<div class="cai-msg-meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10v4h4l5 4V6l-5 4H3z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/></svg></div>`
            : '';
        return `<div class="cai-msg-row ${cls}">
            <div class="cai-msg-bubble" data-idx="${idx}">${meta}${escapeHtml(text)}</div>
        </div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
}

function firstCharIndex() {
    for (let i = 0; i < state.chat.length; i++) if (!state.chat[i].is_user) return i;
    return -1;
}

function userName() {
    return state.settingsCache?.username || USER_NAME_FALLBACK;
}

function charName() { return state.character?.name || 'Character'; }

// --------- Loading / saving the chat file ---------

async function ensureChatFile() {
    if (state.fileName) return state.fileName;

    // try to pick the latest existing chat file for this character
    try {
        const chats = await api.listCharacterChats(state.avatarFile);
        if (Array.isArray(chats) && chats.length) {
            chats.sort((a, b) => new Date(b.last_mes || 0) - new Date(a.last_mes || 0));
            state.fileName = (chats[0].file_name || '').replace(/\.jsonl?$/i, '');
        }
    } catch (err) { /* no chats yet */ }

    if (!state.fileName) {
        state.fileName = `${charName()} - ${todayChatFileName()}`;
    }
    return state.fileName;
}

async function loadChatFromDisk() {
    try {
        const raw = await api.loadChat(charName(), state.fileName);
        // ST returns an array; first entry may be a chat metadata object.
        const arr = Array.isArray(raw) ? raw : [];
        // Strip metadata entries: ST stores a header object without `mes`.
        state.chat = arr.filter(m => typeof m?.mes === 'string');
    } catch (err) {
        console.warn('[cai/chat] loadChatFromDisk failed', err);
        state.chat = [];
    }

    // Seed with the character's greeting if the chat is empty.
    if (!state.chat.length && state.character?.first_mes) {
        state.chat.push({
            name: charName(),
            is_user: false,
            is_system: false,
            send_date: new Date().toISOString(),
            mes: substituteMacros(state.character.first_mes),
        });
    }
}

async function persistChat() {
    if (!state.fileName) return;
    try {
        // ST expects a chat metadata header as the first array element.
        const metadata = {
            user_name: userName(),
            character_name: charName(),
            create_date: new Date().toISOString(),
            chat_metadata: {},
        };
        await api.saveChat(charName(), state.avatarFile, state.fileName, [metadata, ...state.chat]);
    } catch (err) {
        console.warn('[cai/chat] persistChat failed', err);
    }
}

// --------- Macro substitution + prompt assembly ---------

function substituteMacros(text) {
    if (!text) return '';
    return text
        .replace(/\{\{user\}\}/gi, userName())
        .replace(/\{\{char\}\}/gi, charName());
}

async function buildPromptMessages(memoryPreamble) {
    const ch = state.character;
    const systemBlocks = [];

    if (ch.system_prompt) systemBlocks.push(substituteMacros(ch.system_prompt));

    const persona = [];
    if (ch.description) persona.push(`${charName()}'s description: ${substituteMacros(ch.description)}`);
    if (ch.personality) persona.push(`${charName()}'s personality: ${substituteMacros(ch.personality)}`);
    if (ch.scenario) persona.push(`Scenario: ${substituteMacros(ch.scenario)}`);
    if (persona.length) systemBlocks.push(persona.join('\n\n'));

    if (memoryPreamble) systemBlocks.push(substituteMacros(memoryPreamble));

    if (ch.mes_example) systemBlocks.push(`Example dialogue:\n${substituteMacros(ch.mes_example)}`);

    const msgs = [];
    if (systemBlocks.length) {
        msgs.push({ role: 'system', content: systemBlocks.join('\n\n') });
    }

    for (const m of state.chat) {
        msgs.push({
            role: m.is_user ? 'user' : 'assistant',
            content: m.mes,
        });
    }

    if (ch.post_history_instructions) {
        msgs.push({ role: 'system', content: substituteMacros(ch.post_history_instructions) });
    }

    return msgs;
}

// --------- Chat completion call ---------

async function callChatCompletion(messages, { stream = false, signal } = {}) {
    const settings = state.settingsCache || {};
    const oai = settings.oai_settings || settings.openai_setting || settings.openai_settings || {};
    const source = oai.chat_completion_source || oai.source || 'openrouter';
    const model = oai.openrouter_model || oai.model || oai.openai_model || 'openrouter/auto';

    const payload = {
        messages,
        chat_completion_source: source,
        model,
        max_tokens: oai.openai_max_tokens || oai.max_tokens || 1024,
        temperature: typeof oai.temp_openai === 'number' ? oai.temp_openai : (oai.temperature ?? 0.9),
        stream,
        stream_options: stream ? { include_usage: true } : undefined,
    };

    const res = await api.generateChatCompletion(payload, { signal });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`generation ${res.status}: ${errText.slice(0, 200)}`);
    }
    if (!stream) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content ?? data?.content ?? '';
    }
    return res;
}

async function* streamChatCompletion(messages, { signal } = {}) {
    const res = await callChatCompletion(messages, { stream: true, signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content
                    ?? parsed?.choices?.[0]?.message?.content
                    ?? '';
                if (delta) yield delta;
            } catch (e) { /* not JSON, ignore */ }
        }
    }
}

// --------- Memory extraction (background) ---------

async function maybeRunExtraction() {
    try {
        const cfg = await api.memory.config(charName());
        if (!cfg.enabled || cfg.mode === 'off') return;
        const interval = cfg.extractionInterval || 10;
        const lastCount = cfg.lastExtractionMessageCount || 0;
        if (state.chat.length - lastCount < interval) return;

        const chatId = cfg.mode === 'isolated' ? state.fileName : null;
        const store = await api.memory.store(charName(), chatId);
        const existingFacts = store?.store?.facts ?? [];

        const recent = state.chat
            .slice(Math.max(0, state.chat.length - interval - 4))
            .map(m => `${m.is_user ? userName() : charName()}: ${m.mes}`)
            .join('\n');

        const promptResp = await api.memory.extractionPrompt({
            recent_messages: recent,
            existing_facts: existingFacts,
            user: userName(),
            char: charName(),
        });

        const extractionResp = await callChatCompletion([
            { role: 'system', content: 'You are a precise memory extraction system. Output JSON only.' },
            { role: 'user', content: promptResp.prompt },
        ], { stream: false });

        const arr = parseFactsResponse(extractionResp);
        if (arr.length) {
            await api.memory.addFacts(charName(), arr, chatId);
        }

        // Regenerate the summary if we added something or if there are >0 facts.
        const updated = await api.memory.store(charName(), chatId);
        const allFacts = updated?.store?.facts ?? [];
        if (allFacts.length) {
            const sumPromptResp = await api.memory.summaryPrompt({
                facts: allFacts,
                user: userName(),
                char: charName(),
            });
            const newSummary = await callChatCompletion([
                { role: 'system', content: 'You are a precise narrative summarizer.' },
                { role: 'user', content: sumPromptResp.prompt },
            ], { stream: false });
            await api.memory.setSummary(charName(), (newSummary || '').trim(), chatId);
        }

        await api.memory.setConfig(charName(), { lastExtractionMessageCount: state.chat.length });
    } catch (err) {
        console.warn('[cai/chat] memory extraction failed', err);
    }
}

function parseFactsResponse(text) {
    if (!text) return [];
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed.filter(f => f?.content) : [];
    } catch (err) {
        return [];
    }
}

// --------- Send / receive flow ---------

async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || !state.character) return;

    state.chat.push({
        name: userName(),
        is_user: true,
        is_system: false,
        send_date: new Date().toISOString(),
        mes: text,
    });
    renderMessages();

    // Insert a "typing" placeholder bubble for the assistant.
    state.chat.push({
        name: charName(),
        is_user: false,
        is_system: false,
        send_date: new Date().toISOString(),
        mes: '',
        _typing: true,
    });
    renderMessages();

    let memoryPreamble = '';
    try {
        const chatId = (await api.memory.config(charName()).catch(() => null))?.mode === 'isolated'
            ? state.fileName : null;
        const pre = await api.memory.preamble(charName(), chatId);
        memoryPreamble = pre.preamble || '';
    } catch (err) { /* no memory yet — fine */ }

    const messages = await buildPromptMessages(memoryPreamble);
    const controller = new AbortController();
    state.pendingAbort = controller;

    let accumulated = '';
    try {
        for await (const chunk of streamChatCompletion(messages, { signal: controller.signal })) {
            accumulated += chunk;
            const last = state.chat[state.chat.length - 1];
            last.mes = accumulated;
            delete last._typing;
            renderMessages();
        }
    } catch (err) {
        const last = state.chat[state.chat.length - 1];
        last.mes = `*[generation failed: ${escapeHtml(err.message)}]*`;
        delete last._typing;
        renderMessages();
    } finally {
        state.pendingAbort = null;
    }

    await persistChat();
    // Fire and forget — extraction shouldn't block the UI.
    maybeRunExtraction();
}

// --------- Entry point ---------

async function enterChat(ctx) {
    if (!ctx) return;
    state.character = ctx.character;
    state.avatarFile = ctx.avatarFile;
    state.fileName = ctx.fileName || null;

    state.settingsCache = await api.getUserSettings();

    renderHeader();
    await ensureChatFile();
    await loadChatFromDisk();
    renderMessages();

    // Persist the initial chat (with greeting) so the chats list picks it up.
    if (state.chat.length === 1 && !state.chat[0].is_user) {
        persistChat();
    }
}

export function initChat() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const memBtn = document.getElementById('chat-memory-btn');

    if (input) {
        input.addEventListener('input', () => {
            autoGrow(input);
            sendBtn.classList.toggle('cai-send-active', input.value.trim().length > 0);
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSend();
            }
        });
    }

    if (sendBtn) sendBtn.addEventListener('click', doSend);
    if (memBtn) memBtn.addEventListener('click', () => {
        if (state.character) openMemorySheet({
            character: state.character,
            fileName: state.fileName,
        });
    });

    function doSend() {
        const text = input.value;
        input.value = '';
        autoGrow(input);
        sendBtn.classList.remove('cai-send-active');
        sendMessage(text);
    }

    onRouteChange((route) => {
        if (route === 'chat') {
            const ctx = getChatContext();
            enterChat(ctx);
        } else if (state.pendingAbort) {
            state.pendingAbort.abort();
            state.pendingAbort = null;
        }
    });
}
