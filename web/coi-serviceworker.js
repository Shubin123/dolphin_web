// Adds the cross-origin isolation headers needed by Emscripten pthreads on
// static hosts such as GitHub Pages. The first visit reloads once after this
// worker takes control; normal servers should still send these headers
// directly, which avoids the reload.
'use strict';

self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;

    event.respondWith((async () => {
        // A conditional request can return an empty 304 from Pages. Wrapping
        // that response loses the browser's cached body (including bootstrap
        // scripts), leaving reloads stuck before controls initialize.
        const requestHeaders = new Headers(event.request.headers);
        requestHeaders.delete('if-none-match');
        requestHeaders.delete('if-modified-since');
        const response = await fetch(new Request(event.request, {
            headers: requestHeaders,
            cache: 'no-store'
        }));
        if (response.type === 'opaque') return response;

        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        headers.set('Cache-Control', 'no-store');
        for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive']) headers.delete(name);
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    })());
});
