const SUPABASE_URL = 'https://fqpxbvpjugbqelivtyae.supabase.co'
const SUPABASE_KEY = 'sb_publishable_i7AYnNWMo1tBnqGZ7og8EA_FJK9nqFU'

window._db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
})
