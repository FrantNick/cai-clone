// Bootstrap for the Character.AI clone shell.
//
// We do not touch SillyTavern's own JS (public/scripts/*) — the original UI
// stays accessible at /admin.html for power-user / setup tasks.
// This script wires up the 3 views (Home / Chats / Chat), the memory modal,
// and the bottom-nav.

import { initRouter, onRouteChange } from './router.js';
import { initHome, refreshHome } from './home.js';
import { initChats, refreshChats } from './chats.js';
import { initChat } from './chat.js';
import { initMemory } from './memory.js';

async function boot() {
    // 1) Warm the CSRF token cache early so subsequent POSTs don't race.
    try { await fetch('/csrf-token'); } catch (err) { /* offline boot */ }

    // 2) Initialize views.
    initHome();
    initChats();
    initChat();
    initMemory();

    // 3) Hook view transitions for cross-cutting refreshes.
    onRouteChange((route) => {
        if (route === 'chats') refreshChats();
        if (route === 'home') refreshHome();
    });

    // 4) Start the router (lands on Home by default).
    initRouter();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
