// ARK OS — Guest Portal Auth Edge Function
// Validates a portal access token and returns safe booking + unit data.
// Called by guest.html on load — uses service role so guests don't need a session.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type':                 'application/json',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { token } = await req.json()
    if (!token?.trim()) {
      return new Response(JSON.stringify({ error: 'no_token' }), { status: 400, headers: CORS })
    }

    // Look up booking by token
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, guest_name, check_in, check_out, accommodations, status')
      .eq('access_token', token.trim())
      .single()

    if (error || !booking) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 404, headers: CORS })
    }

    // Check access window: 1 day before check-in until check-out
    const now      = new Date()
    const checkIn  = new Date(booking.check_in)
    const checkOut = new Date(booking.check_out)
    checkIn.setDate(checkIn.getDate() - 1) // allow 1 day early access
    checkOut.setHours(23, 59, 59, 999)

    if (now < checkIn) {
      return new Response(JSON.stringify({ error: 'not_yet', checkIn: booking.check_in }), { status: 403, headers: CORS })
    }
    if (now > checkOut) {
      return new Response(JSON.stringify({ error: 'expired', checkOut: booking.check_out }), { status: 403, headers: CORS })
    }

    // Fetch unit details + unit_info
    const unitIds = booking.accommodations || []
    const [{ data: units }, { data: unitInfos }] = await Promise.all([
      supabase.from('units').select('id, name, color').in('id', unitIds),
      supabase.from('unit_info').select('*').in('unit_id', unitIds),
    ])

    return new Response(JSON.stringify({
      booking: {
        id:        booking.id,
        guestName: booking.guest_name,
        checkIn:   booking.check_in,
        checkOut:  booking.check_out,
        status:    booking.status,
      },
      units:    units    || [],
      unitInfo: unitInfos?.[0] || {},
    }), { headers: CORS })

  } catch (e) {
    return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: CORS })
  }
})
