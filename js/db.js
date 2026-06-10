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
  if (typeof window.onDataChange === 'function') window.onDataChange()
}

window.addEventListener('online', _replayQueue)

// ─── DB object ────────────────────────────────────────────────────────────

const _CACHE_KEY = 'ark_db_v1'
const _CACHE_TTL = 90_000 // 90 s — serve from cache, refresh silently after

window.DB = {
  _bookings: [], _expenses: [], _tasks: [], _extras: [], _units: [],

  async load() {
    // Try localStorage cache — persists across sessions for full offline support
    try {
      const raw = localStorage.getItem(_CACHE_KEY)
      if (raw) {
        const { ts, d } = JSON.parse(raw)
        const age = Date.now() - ts
        // Offline: use any cached data regardless of age
        // Online + fresh (< TTL): use cache and refresh silently in background
        if (!navigator.onLine || age < _CACHE_TTL) {
          this._bookings = d.bookings
          this._expenses = d.expenses
          this._tasks    = d.tasks
          this._extras   = d.extras || []
          this._units    = d.units
          this.setupRealtime()
          if (navigator.onLine) {
            // Refresh silently in background; re-render when done
            this._fetchAll().then(() => {
              if (typeof window.onDataChange === 'function') window.onDataChange()
            })
          }
          return
        }
      }
    } catch (_) {}
    // No cache or expired — wait for fresh fetch
    await this._fetchAll()
    this.setupRealtime()
  },

  async _fetchAll() {
    const [b, e, t, x, u] = await Promise.all([
      window._db.from('bookings').select('*').order('created_at', { ascending: false }),
      window._db.from('expenses').select('*').order('date', { ascending: false }),
      window._db.from('tasks').select('*').order('created_at', { ascending: false }),
      window._db.from('extras').select('*').order('name'),
      window._db.from('units').select('*').order('sort_order'),
    ])
    this._bookings = (b.data || []).map(rowToBooking)
    this._expenses = (e.data || []).map(rowToExpense)
    this._tasks    = (t.data || []).map(rowToTask)
    this._extras   = (x.data || []).map(rowToExtra)
    this._units    = (u.data || []).map(rowToUnit)
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
      INSERT: ({ new: r }) => { const item = mapper(r); if (!self[arr].find(x => x.id === item.id)) self[arr].unshift(item); window.onDataChange?.() },
      UPDATE: ({ new: r }) => { const item = mapper(r); const i = self[arr].findIndex(x => x.id === item.id); if (i >= 0) self[arr][i] = item; else self[arr].unshift(item); window.onDataChange?.() },
      DELETE: ({ old: r }) => { self[arr] = self[arr].filter(x => x.id !== r.id); window.onDataChange?.() },
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
