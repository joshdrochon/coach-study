const FALLBACK = {
  title: 'Coach Study',
  body: 'Start when you’re ready.',
  url: '/',
  tag: 'coach-study-reminder',
}

function samePath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/'
}

function text(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function readMessage(data) {
  let message = {}
  try {
    message = data ? data.json() : {}
  } catch {
    message = {}
  }
  if (typeof message !== 'object' || message === null) message = {}
  return {
    title: text(message.title, FALLBACK.title),
    body: text(message.body, FALLBACK.body),
    url: samePath(message.url),
    tag: text(message.tag, FALLBACK.tag),
  }
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const message = readMessage(event.data)
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icon.png',
      data: { url: message.url },
    }),
  )
})

async function openApp(target) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = windows.find((client) => 'focus' in client)
  if (!open) return self.clients.openWindow(target)
  const focused = await open.focus()
  if (focused && focused.url !== target && 'navigate' in focused) {
    try {
      return await focused.navigate(target)
    } catch {}
  }
  return focused
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  const target = new URL(samePath(data && data.url), self.location.origin).href
  event.waitUntil(openApp(target))
})
