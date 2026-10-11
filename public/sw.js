const CACHE_PREFIX = 'sandiman-pwa-'
const CACHE_NAME = `${CACHE_PREFIX}v1`
const APP_ROOT = new URL('./', self.registration.scope)
const INDEX_URL = new URL('index.html', APP_ROOT).href
const ROOT_URL = APP_ROOT.href
const ASSET_PATH = new URL('assets/', APP_ROOT).pathname
const BUILD_MANIFEST_URL = new URL('asset-manifest.json', APP_ROOT).href
const SHELL_URLS = [
  ROOT_URL,
  INDEX_URL,
  BUILD_MANIFEST_URL,
  new URL('manifest.webmanifest', APP_ROOT).href,
  new URL('icons/icon-192.png', APP_ROOT).href,
  new URL('icons/icon-512.png', APP_ROOT).href,
  new URL('icons/apple-touch-icon.png', APP_ROOT).href,
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(SHELL_URLS)

    // Cache every built asset on install, since the first page load may finish
    // before this worker controls its JS, CSS, and worker requests.
    const manifestResponse = await cache.match(BUILD_MANIFEST_URL)
    const manifest = await manifestResponse.json()
    const assets = Object.values(manifest).flatMap((entry) => [
      entry.file,
      ...(entry.css || []),
      ...(entry.assets || []),
    ])
    const urls = [...new Set(assets)]
      .filter((asset) => typeof asset === 'string')
      .map((asset) => new URL(asset, APP_ROOT))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => url.href)
    await cache.addAll(urls)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        return (await cache.match(INDEX_URL)) || (await cache.match(ROOT_URL)) || Response.error()
      }),
    )
    return
  }

  const isAppAsset =
    ['script', 'style', 'image', 'font'].includes(request.destination) ||
    url.pathname.startsWith(ASSET_PATH) ||
    url.pathname === new URL('manifest.webmanifest', APP_ROOT).pathname

  if (!isAppAsset) return

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
      }
      return response
    }),
  )
})
