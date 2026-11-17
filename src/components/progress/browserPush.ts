import type { PushEnv, PushSubscriptionLike } from '@/lib/nudges/client'
import { appMode } from '@/lib/speech/browser'

const SERVICE_WORKER = '/sw.js'

export function browserPushEnv(): PushEnv {
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  return {
    standalone: appMode() === 'home-screen',
    supported,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    async current(): Promise<PushSubscriptionLike | null> {
      const registration = await navigator.serviceWorker.getRegistration('/')
      return (await registration?.pushManager.getSubscription()) ?? null
    },
    async subscribe(applicationServerKey): Promise<PushSubscriptionLike> {
      await navigator.serviceWorker.register(SERVICE_WORKER, { scope: '/' })
      const registration = await navigator.serviceWorker.ready
      return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    },
  }
}
