// ─── Field mappers: camelCase (app) ↔ snake_case (Supabase) ───────────────

// ── Access token generator (unambiguous chars, 8 chars) ──
function _generatePortalToken() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => chars[b % chars.length]).join('')
}

function bookingToRow(b) {
  return {
    id: b.id, guest_name: b.guestName, phone: b.phone,
    accommodations: b.accommodations, check_in: b.checkIn, check_out: b.checkOut,
    group_size: b.groupSize, extras: b.extras, base_amount: b.baseAmount,
    discount_amount: b.discountAmount, final_amount: b.finalAmount,
    payment_status: b.paymentStatus, status: b.status, source: b.source,
    tags: b.tags, override_conflict: b.overrideConflict, notes: b.notes,
    paid_at: b.paidAt || null, deposit_amount: b.depositAmount || 0,
    access_token: b.accessToken || null,
  }
}
function rowToBooking(r) {
  return {
    id: r.id, guestName: r.guest_name, phone: r.phone,
    accommodations: r.accommodations || [], checkIn: r.check_in, checkOut: r.check_out,
    groupSize: r.group_size, extras: r.extras || [], baseAmount: r.base_amount || 0,
    discountAmount: r.discount_amount || 0, finalAmount: r.final_amount || 0,
    paymentStatus: r.payment_status, status: r.status, source: r.source,
    tags: r.tags || [], overrideConflict: r.override_conflict, notes: r.notes,
    paidAt: r.paid_at || null, depositAmount: r.deposit_amount || 0, createdAt: r.created_at,
    accessToken: r.access_token || null,
  }
}

function expenseToRow(e) {
  return {
    id: e.id, date: e.date, amount: e.amount, category: e.category,
    accommodation: e.accommodation, description: e.description,
    paid_by: e.paidBy, notes: e.notes,
  }
}
function rowToExpense(r) {
  return {
    id: r.id, date: r.date, amount: r.amount, category: r.category,
    accommodation: r.accommodation, description: r.description,
    paidBy: r.paid_by, notes: r.notes, createdAt: r.created_at,
  }
}

function taskToRow(t) {
  return {
    id: t.id, title: t.title, category: t.category,
    unit_id: t.unitId, date: t.date, notes: t.notes,
    status: t.status, priority: t.priority,
  }
}
function rowToTask(r) {
  return {
    id: r.id, title: r.title, category: r.category,
    unitId: r.unit_id, date: r.date, notes: r.notes,
    status: r.status, priority: r.priority || 'Medium', createdAt: r.created_at,
  }
}

function unitToRow(u) {
  return {
    id: u.id, name: u.name, color: u.color,
    nightly_rate: u.nightlyRate || 0, weekend_rate: u.weekendRate || 0,
    cleaning_fee: u.cleaningFee || 0, active: u.active !== false,
    sort_order: u.sortOrder || 0,
  }
}
function rowToUnit(r) {
  return {
    id: r.id, name: r.name, color: r.color,
    nightlyRate: r.nightly_rate || 0, weekendRate: r.weekend_rate || 0,
    cleaningFee: r.cleaning_fee || 0, active: r.active, sortOrder: r.sort_order,
  }
}

function extraToRow(e) {
  return { id: e.id, name: e.name, default_price: e.defaultPrice || 0 }
}
function rowToExtra(r) {
  return { id: r.id, name: r.name, defaultPrice: r.default_price || 0 }
}

// ─── Offline mutation queue ───────────────────────────────────────────────
// Writes that fail while offline are queued in localStorage and replayed
// automatically the moment the device comes back online.

const _QUEUE_KEY = 'ark_mutation_queue'

function _getQueue()  { try { return JSON.parse(localStorage.getItem(_QUEUE_KEY)) || [] } catch(_) { return [] } }
function _saveQueue(q){ try { localStorage.setItem(_QUEUE_KEY, JSON.stringify(q)) } catch(_) {} }

function _enqueue(method, arg) {
  const q = _getQueue()
  q.push({ method, arg, ts: Date.now() })
  _saveQueue(q)
  console.log(`[ARK] Queued offline: ${method}`)
}

async function _replayQueue() {
  const q = _getQueue()
  if (!q.length) return
  console.log(`[ARK] Replaying ${q.length} queued mutation(s)`)
  _saveQueue([]) // clear before replaying so a second reconnect doesn't double-replay
  for (const op of q) {
    try { await window.DB[op.method](op.arg) }
    catch(e) { console.error(`[ARK] Failed to replay ${op.method}:`, e) }
  }
  _fireDataChange()
}

window.addEventListener('online', _replayQueue)

// ─── DB object ────────────────────────────────────────────────────────────

const _CACHE_KEY  = 'ark_db_v1'
const _CACHE_TTL  = 2 * 60 * 1000   // 2 minutes — skip background fetch if fresher

// Debounced onDataChange: batch rapid realtime events into a single render
let _dcTimer = null
function _fireDataChange() {
  clearTimeout(_dcTimer)
  _dcTimer = setTimeout(() => { if (typeof window.onDataChange === 'function') window.onDataChange() }, 80)
}

window.DB = {
  _bookings: [], _expenses: [], _tasks: [], _extras: [], _units: [],

  async load() {
    // 1. Try localStorage cache — use it instantly if present.
    let hasCache = false
    let cacheAge = Infinity
    try {
      const raw = localStorage.getItem(_CACHE_KEY)
      if (raw) {
        const { ts, d } = JSON.parse(raw)
        if (d && Array.isArray(d.bookings) && d.bookings.length > 0) {
          this._bookings = d.bookings
          this._expenses = d.expenses || []
          this._tasks    = d.tasks    || []
          this._extras   = d.extras   || []
          this._units    = d.units    || []
          hasCache  = true
          cacheAge  = Date.now() - (ts || 0)
        }
      }
    } catch (_) {}

    if (!hasCache) {
      // First-ever load — must fetch before rendering
      await this._fetchAll()
      this.setupRealtime()
      return
    }

    // 2. Render instantly from cache.
    //    Only background-refresh if cache is stale (> 2 min).
    //    Realtime subscription keeps data live within that window.
    this.setupRealtime()
    if (navigator.onLine && cacheAge > _CACHE_TTL) {
      this._fetchAll()
        .then(() => _fireDataChange())
        .catch(err => console.error('[ARK] Background fetch failed:', err))
    }
  },

  async _fetchAll() {
    const [b, e, t, x, u] = await Promise.all([
      window._db.from('bookings').select('*').order('created_at', { ascending: false }),
      window._db.from('expenses').select('*').order('date', { ascending: false }),
      window._db.from('tasks').select('*').order('created_at', { ascending: false }),
      window._db.from('extras').select('*').order('name'),
      window._db.from('units').select('*').order('sort_order'),
    ])
    if (b.error) console.error('[ARK] bookings fetch error:', b.error.message)
    if (e.error) console.error('[ARK] expenses fetch error:', e.error.message)
    if (t.error) console.error('[ARK] tasks fetch error:', t.error.message)
    if (x.error) console.error('[ARK] extras fetch error:', x.error.message)
    if (u.error) console.error('[ARK] units fetch error:', u.error.message)

    // Guard: if the bookings query failed OR returned fewer rows than we already
    // have in memory, this is almost certainly an auth-token hiccup mid-navigation
    // (Supabase returns [] with no error when the session hasn't refreshed yet).
    // Keep the existing cache — don't wipe good data with a bad result.
    const freshCount  = b.data ? b.data.length  : -1
    const cachedCount = this._bookings.length
    if (b.error || freshCount < 0 || (freshCount === 0 && cachedCount > 0)) {
      console.warn('[ARK] _fetchAll skipped cache update — bookings result looks wrong',
                   { freshCount, cachedCount, error: b.error?.message })
      return
    }

    this._bookings = b.data.map(rowToBooking)
    if (!e.error && e.data) this._expenses = e.data.map(rowToExpense)
    if (!t.error && t.data) this._tasks    = t.data.map(rowToTask)
    if (!x.error && x.data) this._extras   = x.data.map(rowToExtra)
    if (!u.error && u.data) this._units    = u.data.map(rowToUnit)
    this._saveCache()
  },

  _saveCache() {
    try {
      localStorage.setItem(_CACHE_KEY, JSON.stringify({
        ts: Date.now(),
        d: {
          bookings: this._bookings, expenses: this._expenses,
          tasks:    this._tasks,    extras:   this._extras,
          units:    this._units,
        }
      }))
    } catch (_) {}
  },

  // ── Sync reads (from memory) ──
  getBookings() { return this._bookings },
  getExpenses() { return this._expenses },
  getCosts()    { return this._expenses },   // alias used by finance + analytics
  getTasks()    { return this._tasks },
  getExtras()   { return this._extras },
  getUnits()    { return this._units },

  // ── Async writes — offline-safe ──
  // If the device is offline the write is applied to memory immediately
  // (optimistic) and queued for replay when connectivity returns.

  async saveBooking(b) {
    // Ensure every booking has a portal access token
    if (!b.accessToken) b.accessToken = _generatePortalToken()
    if (!navigator.onLine) {
      const idx = this._bookings.findIndex(x => x.id === b.id)
      if (idx >= 0) this._bookings[idx] = b; else this._bookings.unshift(b)
      this._saveCache(); _enqueue('saveBooking', b); return b
    }
    const { data, error } = await window._db.from('bookings')
      .upsert(bookingToRow(b), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToBooking(data)
    const idx = this._bookings.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._bookings[idx] = saved; else this._bookings.unshift(saved)
    this._saveCache(); return saved
  },
  async deleteBooking(id) {
    this._bookings = this._bookings.filter(x => x.id !== id)
    this._saveCache()
    if (!navigator.onLine) { _enqueue('deleteBooking', id); return }
    const { error } = await window._db.from('bookings').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
  },

  async saveCost(e)    { return this.saveExpense(e) },
  async deleteCost(id) { return this.deleteExpense(id) },
  async saveExpense(e) {
    if (!navigator.onLine) {
      const idx = this._expenses.findIndex(x => x.id === e.id)
      if (idx >= 0) this._expenses[idx] = e; else this._expenses.unshift(e)
      this._saveCache(); _enqueue('saveExpense', e); return e
    }
    const { data, error } = await window._db.from('expenses')
      .upsert(expenseToRow(e), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToExpense(data)
    const idx = this._expenses.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._expenses[idx] = saved; else this._expenses.unshift(saved)
    this._saveCache(); return saved
  },
  async deleteExpense(id) {
    this._expenses = this._expenses.filter(x => x.id !== id)
    this._saveCache()
    if (!navigator.onLine) { _enqueue('deleteExpense', id); return }
    const { error } = await window._db.from('expenses').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
  },

  async saveTask(t) {
    if (!navigator.onLine) {
      const idx = this._tasks.findIndex(x => x.id === t.id)
      if (idx >= 0) this._tasks[idx] = t; else this._tasks.unshift(t)
      this._saveCache(); _enqueue('saveTask', t); return t
    }
    const { data, error } = await window._db.from('tasks')
      .upsert(taskToRow(t), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToTask(data)
    const idx = this._tasks.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._tasks[idx] = saved; else this._tasks.unshift(saved)
    this._saveCache(); return saved
  },
  async deleteTask(id) {
    this._tasks = this._tasks.filter(x => x.id !== id)
    this._saveCache()
    if (!navigator.onLine) { _enqueue('deleteTask', id); return }
    const { error } = await window._db.from('tasks').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
  },

  async saveExtra(e) {
    if (!navigator.onLine) {
      const idx = this._extras.findIndex(x => x.id === e.id)
      if (idx >= 0) this._extras[idx] = e; else this._extras.push(e)
      this._saveCache(); _enqueue('saveExtra', e); return e
    }
    const { data, error } = await window._db.from('extras')
      .upsert(extraToRow(e), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToExtra(data)
    const idx = this._extras.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._extras[idx] = saved; else this._extras.push(saved)
    this._saveCache(); return saved
  },
  async deleteExtra(id) {
    const { error } = await window._db.from('extras').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
    this._extras = this._extras.filter(x => x.id !== id)
    this._saveCache()
  },

  async saveUnit(u) {
    const { data, error } = await window._db.from('units')
      .upsert(unitToRow(u), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToUnit(data)
    const idx = this._units.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._units[idx] = saved; else this._units.push(saved)
    this._saveCache(); return saved
  },

  setupRealtime() {
    const self = this
    const make = (mapper, arr) => ({
      INSERT: ({ new: r }) => { const item = mapper(r); if (!self[arr].find(x => x.id === item.id)) self[arr].unshift(item); _fireDataChange() },
      UPDATE: ({ new: r }) => { const item = mapper(r); const i = self[arr].findIndex(x => x.id === item.id); if (i >= 0) self[arr][i] = item; else self[arr].unshift(item); _fireDataChange() },
      DELETE: ({ old: r }) => { self[arr] = self[arr].filter(x => x.id !== r.id); _fireDataChange() },
    })
    const b = make(rowToBooking, '_bookings')
    const e = make(rowToExpense, '_expenses')
    const t = make(rowToTask,    '_tasks')
    const x = make(rowToExtra,   '_extras')
    const u = make(rowToUnit,    '_units')
    window._db.channel('ark-realtime')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'bookings'},  b.INSERT)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'bookings'},  b.UPDATE)
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'bookings'},  b.DELETE)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'expenses'},  e.INSERT)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'expenses'},  e.UPDATE)
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'expenses'},  e.DELETE)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'tasks'},     t.INSERT)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'tasks'},     t.UPDATE)
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'tasks'},     t.DELETE)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'extras'},    x.INSERT)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'extras'},    x.UPDATE)
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'extras'},    x.DELETE)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'units'},     u.INSERT)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'units'},     u.UPDATE)
      .on('postgres_changes',{event:'DELETE',schema:'public',table:'units'},     u.DELETE)
      .subscribe()
  },
}
