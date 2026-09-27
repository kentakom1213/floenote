# PWA foundation

Floe Note Web is an installable Progressive Web App. The PWA layer exists to
make the frontend application shell available when the network is unavailable.
It does not become a second persistence or synchronization layer.

## Service worker cache boundary

The generated service worker precaches only build-time frontend resources:

- `index.html` and the application shell;
- hashed JavaScript and CSS bundles;
- PWA/favicons and other static images;
- bundled/static fonts and other immutable frontend assets;
- the generated Web App Manifest.

There is deliberately no runtime API cache. The service worker does not cache
coordinator, signaling, invitation, presence, SecurityTransition, or other
network application-data responses. It also does not store Workspace data,
Device Vault contents, WorkspaceKeys, private keys, pairing secrets, or decrypted
notes.

Workspace data continues to use the existing encrypted IndexedDB / CRDT storage
path. The architectural boundary remains:

> Local work is coordinator-independent; cross-device coordination is
> coordinator-dependent.

## Offline capability

After the production application has been loaded online at least once, the
precache can start the Floe Note frontend without a network connection. An
existing local Workspace can then follow the normal Device Vault and IndexedDB
path for local read, edit, note creation, Trash/restore, encrypted persistence,
and portable export.

Operations that require the coordinator or another device remain network
operations. Workspace creation, device authorization/revocation, a new invitation
join, presence, and WebRTC signaling may report their existing offline/error
states. The PWA layer never returns a cached success for those operations.

Navigation requests use the cached SPA shell without changing the requested
browser URL. This also applies to `/join/v1/<inviteId>`: the route and its URL
fragment remain available to the application. A new invitation cannot complete
offline because its coordinator calls are intentionally not cached.

## Updates

Floe Note uses prompt-based service-worker updates.

1. The browser checks for updates during normal service-worker lifecycle
   checks; while Floe Note stays open, it also requests a service-worker update
   check about once per hour when online.
2. The browser downloads a changed service worker and its precached application
   assets.
3. The new worker waits instead of taking over the current editing session.
4. Floe Note shows `A new version of Floe Note is available. [Reload]`.
5. Only when the user chooses **Reload** does the waiting worker activate and
   the page reload into the new application version.

Old Workbox precaches are cleaned up when the new worker activates. This
lifecycle is separate from IndexedDB schema migration and from the existing Web
version / Git build SHA observability.

The Vite development server does not enable the service worker. Test PWA
behavior with a production build and preview server instead.

## Manual verification

Build and serve the production application:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @floe-note/web exec vite preview
```

Use Chromium on the preview origin (localhost is accepted as a secure context)
and verify:

1. DevTools **Application > Manifest** shows `Floe Note`, standalone display,
   and valid 192px / 512px icons, and the browser offers installation.
2. Install the application and confirm that it opens in a standalone window.
3. Open/unlock an already-local Workspace once online. In DevTools **Network**,
   select **Offline**, then reload or relaunch the installed PWA. The frontend
   shell should start and the existing local Workspace should remain available
   through the normal Device Vault / IndexedDB path.
4. While offline, local edits should continue to persist locally. Coordinator
   operations are allowed to show their normal network/error state and must not
   appear to succeed from a service-worker cache.
5. Open an invitation URL such as `/join/v1/<inviteId>#s=...` online and confirm
   the existing join route still runs. Offline, the shell may open but a new
   invitation is not expected to complete.
6. For update behavior, serve build A and load it so service worker A controls
   the page. Produce and deploy build B, then trigger/check for a service-worker
   update. Confirm that the current page is not reloaded automatically, the
   update banner appears, and choosing **Reload** activates B and reloads the
   application.

Firefox desktop should continue to work as a normal web application. A desktop
PWA installation UI in Firefox is not a product requirement.
