const CACHE = "detector-v1";
const ASSETS = ["./","./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-180.png"];
self.addEventListener("install", e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); });
self.addEventListener("activate", e=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE&&caches.delete(k))))); });
self.addEventListener("fetch", e=>{ e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request))); });
