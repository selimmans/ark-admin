// ARK OS — Daily Push Notification Edge Function
// Runs on a cron schedule (see README for setup).
// Sends morning briefings: arrivals, departures, cleanings, unpaid reminders.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

webpush.setVapidDetails(
  'mailto:admin@ark.local',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
)

Deno.serve(async (_req) => {
  const today    = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().split('T')[0]

  // Pull relevant data
  const [{ data: bookings }, { data: cleaning }, { data: subs }] = await Promise.all([
    supabase.from('bookings').select('status,payment_status,check_in,check_out').neq('status', 'cancelled'),
    supabase.from('cleaning_tasks').select('status,date').eq('date', today).eq('status', 'pending'),
    supabase.from('push_subscriptions').select('*'),
  ])

  const arrivals   = (bookings || []).filter(b => b.check_in?.startsWith(today)).length
  const departures = (bookings || []).filter(b => b.check_out?.startsWith(today)).length
  const cleanings  = (cleaning  || []).length
  const unpaidSoon = (bookings  || []).filter(b =>
    b.status === 'confirmed' && b.payment_status === 'unpaid' &&
    b.check_in >= today && b.check_in <= tomorrow
  ).length

  // Nothing to report → skip
  if (!arrivals && !departures && !cleanings && !unpaidSoon) {
    return new Response(JSON.stringify({ sent: 0, reason: 'nothing to report' }))
  }

  const parts: string[] = []
  if (arrivals)   parts.push(`${arrivals} arrival${arrivals   > 1 ? 's' : ''}`)
  if (departures) parts.push(`${departures} departure${departures > 1 ? 's' : ''}`)
  if (cleanings)  parts.push(`${cleanings} cleaning${cleanings  > 1 ? 's' : ''} pending`)
  if (unpaidSoon) parts.push(`${unpaidSoon} unpaid booking${unpaidSoon > 1 ? 's' : ''} due soon`)

  const payload = JSON.stringify({
    title: 'ARK OS · Today',
    body:  parts.join(' · '),
    icon:  '/ark-admin/icons/icon-192.png',
    url:   'https://selimmans.github.io/ark-admin/index.html',
  })

  let sent = 0
  const expired: string[] = []

  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      sent++
    } catch (err: any) {
      // 410 Gone / 404 = subscription expired — clean it up
      if (err.statusCode === 410 || err.statusCode === 404) expired.push(sub.id)
    }
  }

  // Remove stale subscriptions
  if (expired.length) {
    await supabase.from('push_subscriptions').delete().in('id', expired)
  }

  return new Response(JSON.stringify({ sent, expired: expired.length }))
})
