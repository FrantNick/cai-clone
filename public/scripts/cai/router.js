// Lightweight router for the 3 CAI views.
// The "create", "library", "profile" nav items are inert (per spec).

const state = {
    current: 'home',
    chatContext: null,  // { avatarFile, character, fileName }
    listeners: new Set(),
};

const VIEW_IDS = {
    home: 'view-home',
    chats: 'view-chats',
    chat: 'view-chat',
};

export function getRoute() { return state.current; }
export function getChatContext() { return state.chatContext; }
export function onRouteChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }

export function go(route, context = null) {
    if (!VIEW_IDS[route]) return;
    state.current = route;
    if (route === 'chat') state.chatContext = context ?? state.chatContext;

    for (const [name, id] of Object.entries(VIEW_IDS)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.classList.toggle('cai-view-active', name === route);
    }

    // Hide bottom nav when in chat conversation
    const nav = document.getElementById('cai-nav');
    if (nav) nav.style.display = route === 'chat' ? 'none' : 'flex';

    // Update bottom-nav active state
    document.querySelectorAll('.cai-nav-item').forEach(btn => {
        const target = btn.dataset.nav;
        btn.classList.toggle('active', target === route);
    });

    state.listeners.forEach(fn => {
        try { fn(route, state.chatContext); } catch (err) { console.error(err); }
    });
}

export function initRouter() {
    document.querySelectorAll('.cai-nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.nav;
            if (target === 'home' || target === 'chats') go(target);
        });
    });

    const backBtn = document.getElementById('chat-back');
    if (backBtn) backBtn.addEventListener('click', () => go('chats'));

    go('home');
}
