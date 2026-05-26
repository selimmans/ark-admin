# ARK OS — Task Tracker

## Phase 1 — Core Calendar ✓

- [x] Project folder structure
- [x] Multi-unit support (Gharbi, Bahari, Annex, Gibli, Bell Tent)
- [x] Week view calendar — rows per unit, day columns Mon–Sun
- [x] Booking blocks with color coding and day-spanning
- [x] Today column highlight
- [x] Week navigation (prev / next / today)
- [x] Booking modal — full form (guest, stay, extras, pricing, status)
- [x] Multi-accommodation booking support
- [x] Check-in / check-out date + time fields
- [x] Group size stepper
- [x] Extras system — autocomplete from master list, inline creation
- [x] Pricing auto-calculation (nights × rate + cleaning + extras − discount)
- [x] Manual override of final amount
- [x] Conflict/overlap detection
- [x] Manual override with confirmation checkbox
- [x] Payment status toggle (Paid / Unpaid)
- [x] Booking status (Pending / Confirmed / Cancelled / Blocked)
- [x] Blocked bookings rendered with diagonal stripe pattern
- [x] Day modal — hourly timeline with check-in/check-out events
- [x] Settings modal — unit rates (nightly, weekend, cleaning fee)
- [x] Settings modal — extras master list (add / delete)
- [x] localStorage persistence for all data
- [x] Delete booking with confirmation
- [x] Escape key and backdrop click to close modals

## Phase 1 — Finance ✓

- [x] Finance page (finance.html)
- [x] Month selector filter
- [x] Revenue This Month card
- [x] Revenue Next 30 Days card
- [x] Outstanding (unpaid confirmed) card
- [x] Extras Revenue This Month card
- [x] Costs module — Date, Category, Unit, Description, Paid By, Notes, Amount
- [x] Cost categories: Groceries, Maintenance, Cleaning, Staff, Utilities, Supplies, Misc
- [x] Costs table with edit and delete
- [x] Category filter on costs table
- [x] Net Summary — Revenue − Costs = Net This Month
- [x] Add / Edit / Delete cost modal

## Phase 1 — ARK OS Expansion ✓

### Dynamic Accommodation Management
- [x] Units stored in localStorage (not hardcoded)
- [x] initUnits() seeds 5 defaults on first load
- [x] Add new unit (name, color, nightly/weekend/cleaning rates)
- [x] Edit existing unit
- [x] Deactivate / Reactivate unit (no deletes, preserved in history)
- [x] getActiveUnits() used for new bookings
- [x] getUnitById() falls back gracefully for deactivated units in history

### Booking Enhancements
- [x] Booking tags — preset chips (Repeat, Long Stay, European, Family, VIP, Solo, Business)
- [x] Custom tag input on booking modal
- [x] Tags displayed on calendar blocks
- [x] Same-day turnover detection — hasTurnover(unitId, dateStr)
- [x] ↕ turnover indicator on calendar booking blocks
- [x] Subtle tint on calendar cell when turnover detected

### Daily Snapshot Panel
- [x] Arrivals today count
- [x] Departures today count
- [x] Pending cleaning tasks today count
- [x] Open tasks count (across all categories)
- [x] Unpaid confirmed bookings count

### Cleaning Module (cleaning.html)
- [x] Dedicated cleaning tab (separate from calendar)
- [x] Auto-generate cleaning task when confirmed booking is saved
- [x] Deduplication — no duplicate auto-tasks per booking per unit
- [x] Manual cleaning task creation
- [x] Filter by month, unit, status
- [x] Same-day turnover badge on cleaning rows
- [x] Toggle status: Pending ↔ Done (inline click)
- [x] Edit / delete cleaning tasks
- [x] Summary strip: pending today, total pending, completed this month

### Tasks & Complaints (tasks.html)
- [x] Dedicated tasks tab
- [x] Categories: Maintenance / Complaint / Urgent / Supply / Other
- [x] Status: Open / In Progress / Done
- [x] Click-to-cycle status (Open → In Progress → Done → Open)
- [x] Assigned To field
- [x] Per-unit association (optional)
- [x] Date reported field
- [x] Filter by category, unit, status
- [x] Sort: Urgent first, Done last
- [x] Summary strip: open, in progress, done, urgent open
- [x] Add / Edit / Delete via modal

### 5-Tab Navigation
- [x] Calendar | Cleaning | Tasks | Analytics | Finance
- [x] Consistent nav across all pages
- [x] ARK OS branding across all pages

---

## Phase 2 — Analytics ✓

- [x] Analytics page (analytics.html)
- [x] Month + year selector filters
- [x] Top metrics: Revenue, Avg booking length, Revenue per night, Total nights booked
- [x] Occupancy % per unit — CSS bar visualization, nights booked / days in month
- [x] Revenue per unit — relative bar chart, split shared bookings evenly
- [x] Most requested extras — ranked list with count and revenue
- [x] Net per month — Revenue − Costs = Net (mirrors Finance calculation)

---

## Backlog — Future Phases

### Guest Experience
- [ ] Guest stay portal — send guests a link with booking details, arrival instructions, extras

### Operations
- [ ] Cleaning sign-off — photo or note attached to completed task
- [ ] Staff roles & permissions — owner vs. staff access views

### Payments
- [ ] Stripe integration — collect deposits or full payments online
- [ ] Payment link generation per booking

### Platform
- [ ] Multi-device sync — replace localStorage with Supabase or Firebase
- [ ] Export bookings / costs to CSV or PDF
- [ ] Calendar iCal export — Google Calendar / Apple Calendar integration

### AI & Automation
- [ ] AI receipt scanning — upload receipt image, extract vendor / date / total
- [ ] Automated WhatsApp ingestion — parse enquiry messages into draft bookings
