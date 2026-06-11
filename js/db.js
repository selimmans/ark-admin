// ─── Field mappers ────────────────────────────────────────────────────────

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

// ─── DB ───────────────────────────────────────────────────────────────────

window.DB = {
  _bookings: [], _expenses: [], _tasks: [], _extras: [], _units: [],

  async load() {
    const [b, e, t, x, u] = await Promise.all([
      window._db.from('bookings').select('*').order('created_at', { ascending: false }),
      window._db.from('expenses').select('*').order('date', { ascending: false }),
      window._db.from('tasks').select('*').order('created_at', { ascending: false }),
      window._db.from('extras').select('*').order('name'),
      window._db.from('units').select('*').order('sort_order'),
    ])
    this._bookings = b.data ? b.data.map(rowToBooking) : []
    this._expenses = e.data ? e.data.map(rowToExpense) : []
    this._tasks    = t.data ? t.data.map(rowToTask)    : []
    this._extras   = x.data ? x.data.map(rowToExtra)   : []
    this._units    = u.data ? u.data.map(rowToUnit)     : []
  },

  // ── Reads ──
  getBookings() { return this._bookings },
  getExpenses() { return this._expenses },
  getCosts()    { return this._expenses },
  getTasks()    { return this._tasks },
  getExtras()   { return this._extras },
  getUnits()    { return this._units },

  // ── Writes ──
  async saveBooking(b) {
    if (!b.accessToken) b.accessToken = _generatePortalToken()
    const { data, error } = await window._db.from('bookings')
      .upsert(bookingToRow(b), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToBooking(data)
    const idx = this._bookings.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._bookings[idx] = saved; else this._bookings.unshift(saved)
    return saved
  },
  async deleteBooking(id) {
    const { error } = await window._db.from('bookings').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
    this._bookings = this._bookings.filter(x => x.id !== id)
  },

  async saveCost(e)    { return this.saveExpense(e) },
  async deleteCost(id) { return this.deleteExpense(id) },
  async saveExpense(e) {
    const { data, error } = await window._db.from('expenses')
      .upsert(expenseToRow(e), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToExpense(data)
    const idx = this._expenses.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._expenses[idx] = saved; else this._expenses.unshift(saved)
    return saved
  },
  async deleteExpense(id) {
    const { error } = await window._db.from('expenses').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
    this._expenses = this._expenses.filter(x => x.id !== id)
  },

  async saveTask(t) {
    const { data, error } = await window._db.from('tasks')
      .upsert(taskToRow(t), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToTask(data)
    const idx = this._tasks.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._tasks[idx] = saved; else this._tasks.unshift(saved)
    return saved
  },
  async deleteTask(id) {
    const { error } = await window._db.from('tasks').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
    this._tasks = this._tasks.filter(x => x.id !== id)
  },

  async saveExtra(e) {
    const { data, error } = await window._db.from('extras')
      .upsert(extraToRow(e), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToExtra(data)
    const idx = this._extras.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._extras[idx] = saved; else this._extras.push(saved)
    return saved
  },
  async deleteExtra(id) {
    const { error } = await window._db.from('extras').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); throw error }
    this._extras = this._extras.filter(x => x.id !== id)
  },

  async saveUnit(u) {
    const { data, error } = await window._db.from('units')
      .upsert(unitToRow(u), { onConflict: 'id' }).select().single()
    if (error) { alert('Save failed: ' + error.message); throw error }
    const saved = rowToUnit(data)
    const idx = this._units.findIndex(x => x.id === saved.id)
    if (idx >= 0) this._units[idx] = saved; else this._units.push(saved)
    return saved
  },
}
