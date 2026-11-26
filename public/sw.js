/* CivicFlow Volunteer service worker.
 *
 * It caches the shell and same-origin static assets. It never caches API
 * responses: the replica in IndexedDB is the offline source of truth, and a
 * cached command result would outlive the membership that allowed it.
 */
const VERSION = "civicflow-volunteer-v3";
const SHELL = ["/pwa.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("civicflow-volunteer-") && key !== VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// A notification is rendered by this worker, not by the page. The payload is
// written by the dispatcher and contains only display fields and a link.
self.addEventListener("push", (event) => {
  let payload = { title: "CivicFlow", body: "You have an update.", href: "/", tag: undefined };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // A malformed payload still produces a visible notification.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { href: payload.href || "/" },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      requireInteraction: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href =
    typeof event.notification.data?.href === "string" ? event.notification.data.href : "/";
  const target = new URL(
    `/pwa.html#${href.startsWith("/") ? href : `/${href}`}`,
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Supabase and any other API host is left alone entirely.
  if (url.pathname.startsWith("/api/")) return;
  // The competition judging site is a separate, publicly accessible sample.
  // Never cache its navigation as the hosted PWA shell, which would replace
  // offline /pwa.html with the unrelated coordinator demo document.
  if (url.pathname === "/judge" || url.pathname.startsWith("/judge/")) return;

  if (request.mode === "navigate") {
    if (url.pathname !== "/" && url.pathname !== "/pwa.html") return;
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok && fresh.headers.get("content-type")?.includes("text/html")) {
            try {
              const cache = await caches.open(VERSION);
              await cache.put("/pwa.html", fresh.clone());
            } catch {
              // A full cache must not replace a successful online response.
            }
          }
          return fresh;
        } catch {
          const cached = await caches.match("/pwa.html");
          return cached ?? new Response("CivicFlow is offline.", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Cache only public application assets, never arbitrary same-origin data.
  if (
    !url.pathname.startsWith("/assets/") &&
    !url.pathname.startsWith("/icons/") &&
    url.pathname !== "/manifest.webmanifest"
  ) {
    return;
  }
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(request, fresh.clone());
      }
      return fresh;
    })(),
  );
});
