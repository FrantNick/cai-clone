import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';

export const router = express.Router();

const DEFAULT_CONFIG = Object.freeze({
    mode: 'shared',
    enabled: true,
    extractionInterval: 10,
    lastExtractionMessageCount: 0,
});

const PREAMBLE_HEADER = '[Character Memory — What {{char}} remembers about {{user}} from previous conversations:]';

function ensureCharDir(req, charName) {
    const safeChar = sanitize(charName || '');
    if (!safeChar) return null;
    const dir = path.join(req.user.directories.memory, safeChar);
    fs.mkdirSync(dir, { recursive: true });
    return { dir, safeChar };
}

function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.warn(`[memory] Failed to read ${filePath}:`, err.message);
        return fallback;
    }
}

function writeJson(filePath, data) {
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function configPath(charDir) {
    return path.join(charDir, 'config.json');
}

function readConfig(charDir) {
    return { ...DEFAULT_CONFIG, ...readJson(configPath(charDir), {}) };
}

function writeConfig(charDir, partial) {
    const merged = { ...readConfig(charDir), ...partial };
    writeJson(configPath(charDir), merged);
    return merged;
}

function storePath(charDir, charName, chatId) {
    if (chatId) {
        const safeChat = sanitize(chatId).replace(/\.jsonl?$/i, '');
        return path.join(charDir, `${safeChat}.json`);
    }
    return path.join(charDir, 'persistent.json');
}

function emptyStore(charName) {
    return {
        character: charName,
        enabled: true,
        facts: [],
        summary: '',
        updated_at: null,
    };
}

function readStore(charDir, charName, chatId) {
    return readJson(storePath(charDir, charName, chatId), emptyStore(charName));
}

function writeStore(charDir, charName, chatId, store) {
    store.updated_at = new Date().toISOString();
    writeJson(storePath(charDir, charName, chatId), store);
    return store;
}

// GET /api/memory/:char/config
router.get('/:char/config', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    return res.json(readConfig(ctx.dir));
});

// POST /api/memory/:char/config — patch config (mode, enabled, extractionInterval)
router.post('/:char/config', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    const allowed = {};
    if (typeof req.body?.mode === 'string' && ['shared', 'isolated', 'off'].includes(req.body.mode)) {
        allowed.mode = req.body.mode;
    }
    if (typeof req.body?.enabled === 'boolean') allowed.enabled = req.body.enabled;
    if (Number.isFinite(req.body?.extractionInterval) && req.body.extractionInterval >= 2) {
        allowed.extractionInterval = Math.min(100, Math.floor(req.body.extractionInterval));
    }
    if (Number.isFinite(req.body?.lastExtractionMessageCount) && req.body.lastExtractionMessageCount >= 0) {
        allowed.lastExtractionMessageCount = Math.floor(req.body.lastExtractionMessageCount);
    }
    return res.json(writeConfig(ctx.dir, allowed));
});

// GET /api/memory/:char?chat=... — return the active store
router.get('/:char', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    const cfg = readConfig(ctx.dir);
    const chatId = cfg.mode === 'isolated' ? req.query.chat : null;
    return res.json({ config: cfg, store: readStore(ctx.dir, req.params.char, chatId) });
});

// POST /api/memory/:char/facts — append facts (dedupe by content)
router.post('/:char/facts', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    const incoming = Array.isArray(req.body?.facts) ? req.body.facts : [];
    if (!incoming.length) return res.sendStatus(400);

    const cfg = readConfig(ctx.dir);
    const chatId = cfg.mode === 'isolated' ? req.body.chat : null;
    const store = readStore(ctx.dir, req.params.char, chatId);

    const seen = new Set(store.facts.map(f => normalize(f.content)));
    const sourceChat = req.body.chat ?? null;
    let added = 0;
    for (const raw of incoming) {
        const content = (raw?.content ?? '').toString().trim();
        if (!content || seen.has(normalize(content))) continue;
        store.facts.push({
            id: crypto.randomUUID(),
            content,
            source_chat: sourceChat,
            created_at: new Date().toISOString(),
            importance: ['high', 'medium', 'low'].includes(raw?.importance) ? raw.importance : 'medium',
        });
        seen.add(normalize(content));
        added++;
    }

    writeStore(ctx.dir, req.params.char, chatId, store);
    return res.json({ added, total: store.facts.length, store });
});

// DELETE /api/memory/:char/facts/:id?chat=...
router.delete('/:char/facts/:id', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    const cfg = readConfig(ctx.dir);
    const chatId = cfg.mode === 'isolated' ? req.query.chat : null;
    const store = readStore(ctx.dir, req.params.char, chatId);
    const before = store.facts.length;
    store.facts = store.facts.filter(f => f.id !== req.params.id);
    if (store.facts.length === before) return res.sendStatus(404);
    writeStore(ctx.dir, req.params.char, chatId, store);
    return res.json({ deleted: true, store });
});

// PUT /api/memory/:char/summary — replace the rolling summary
router.put('/:char/summary', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    const cfg = readConfig(ctx.dir);
    const chatId = cfg.mode === 'isolated' ? req.body?.chat : null;
    const store = readStore(ctx.dir, req.params.char, chatId);
    store.summary = (req.body?.summary ?? '').toString();
    writeStore(ctx.dir, req.params.char, chatId, store);
    return res.json({ store });
});

// POST /api/memory/:char/clear?chat=...
router.post('/:char/clear', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    const cfg = readConfig(ctx.dir);
    const chatId = cfg.mode === 'isolated' ? (req.body?.chat || req.query?.chat) : null;
    const filePath = storePath(ctx.dir, req.params.char, chatId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.json({ cleared: true });
});

// GET /api/memory/:char/preamble?chat=...&char_placeholder=...&user_placeholder=...
// Returns the formatted memory injection block (or empty string if disabled).
router.get('/:char/preamble', (req, res) => {
    const ctx = ensureCharDir(req, req.params.char);
    if (!ctx) return res.sendStatus(400);
    const cfg = readConfig(ctx.dir);
    if (!cfg.enabled || cfg.mode === 'off') {
        return res.json({ preamble: '', mode: cfg.mode, enabled: cfg.enabled });
    }
    const chatId = cfg.mode === 'isolated' ? req.query.chat : null;
    const store = readStore(ctx.dir, req.params.char, chatId);
    if (!store.summary && !store.facts.length) {
        return res.json({ preamble: '', mode: cfg.mode, enabled: cfg.enabled });
    }

    const header = PREAMBLE_HEADER;
    const body = store.summary
        ? store.summary
        : store.facts.map(f => `- ${f.content}`).join('\n');
    const preamble = `${header}\n${body}`;
    return res.json({ preamble, mode: cfg.mode, enabled: cfg.enabled, store });
});

// Helpers exposed for the extraction frontend.
// POST /api/memory/extraction-prompt — returns a ready-to-send prompt for the extraction LLM call.
router.post('/extraction-prompt', (req, res) => {
    const recent = (req.body?.recent_messages ?? '').toString();
    const existing = Array.isArray(req.body?.existing_facts)
        ? req.body.existing_facts.map(f => `- ${typeof f === 'string' ? f : f.content}`).join('\n')
        : '';
    const userName = (req.body?.user ?? '{{user}}').toString();
    const charName = (req.body?.char ?? '{{char}}').toString();

    const prompt = `You are a memory extraction system. Read the following conversation excerpt between ${userName} and ${charName}.

Extract ONLY factual, important information that ${charName} should remember about ${userName} for future conversations. Focus on:
- ${userName}'s personal details (name, age, location, relationships, occupation)
- ${userName}'s preferences and opinions stated during the conversation
- Key decisions or plot events that happened
- Relationship developments between ${userName} and ${charName}
- Promises, agreements, or commitments made

Respond with a JSON array of fact objects:
[
  {"content": "fact text here", "importance": "high|medium|low"}
]

If no new important facts were revealed, respond with an empty array: []

Conversation excerpt:
${recent}

Previously known facts (do not duplicate these):
${existing || '(none)'}`;
    return res.json({ prompt });
});

// POST /api/memory/summary-prompt — returns a prompt to regenerate the rolling summary.
router.post('/summary-prompt', (req, res) => {
    const facts = Array.isArray(req.body?.facts)
        ? req.body.facts.map(f => `- ${typeof f === 'string' ? f : f.content}`).join('\n')
        : '';
    const userName = (req.body?.user ?? '{{user}}').toString();
    const charName = (req.body?.char ?? '{{char}}').toString();

    const prompt = `You are a memory summarizer for the character ${charName}. Given the following list of individual facts about ${userName}, write a concise 2-4 sentence summary that ${charName} would naturally "remember" about ${userName}.

Write in third person, present tense. Be specific. Do not add information not present in the facts. Focus on what would be most relevant for natural conversation.

Facts:
${facts || '(none)'}

Summary:`;
    return res.json({ prompt });
});

function normalize(s) {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
