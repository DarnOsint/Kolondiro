import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export function usePushNotifications(staffId: string | undefined): void {
  useEffect(() => {
    if (!staffId || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    // Only register if permission already granted — don't auto-request
    // Permission must be requested from a user gesture (see requestPushPermission)
    async function registerIfGranted() {
      try {
        if (Notification.permission !== 'granted') return

        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        const sub =
          existing ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(
              VAPID_PUBLIC_KEY
            ) as unknown as BufferSource,
          }))

        await supabase.from('push_subscriptions').upsert(
          {
            staff_id: staffId,
            subscription: sub.toJSON(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'staff_id,subscription' }
        )
      } catch (e) {
        console.error('Push registration failed:', e)
      }
    }

    void registerIfGranted()
  }, [staffId])
}

/**
 * Call this from a button click handler to request push permission.
 * Must be triggered by a user gesture — cannot be called automatically.
 */
export async function requestPushPermission(staffId: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false

    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      }))

    await supabase.from('push_subscriptions').upsert(
      {
        staff_id: staffId,
        subscription: sub.toJSON(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'staff_id,subscription' }
    )
    return true
  } catch (e) {
    console.error('Push permission failed:', e)
    return false
  }
}

export async function sendPushToStaff(
  staffId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    await fetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': (import.meta.env.VITE_INTERNAL_API_SECRET as string) ?? '',
      },
      body: JSON.stringify({ staff_id: staffId, title, body, data }),
    })
  } catch (e) {
    console.error('Push send failed:', e)
  }
}
