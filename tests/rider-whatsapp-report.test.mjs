import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWhatsappReport, prepareWhatsappPayments, isPayoutDone, paymentWeekOptions, paymentWeekKey, WHATSAPP_COLUMNS } from '../src/lib/riderWhatsappReport.js'

const payment = { id: 1, rider_id: 'R1', rider_name: 'Rider One', month: 'Nov-26', week: '4626', period_start: '2026-11-09', client_name: 'Client A', city: 'Bangalore', payment_status: 'Released', orders: 10, cod_deduction: '1,000', ev_rent: 200, final_net_payout: 800, tds: 500 }
const contacts = { onboardingRows: [{ rider_id_details: 'R1', rider_mobile_number: '+91 98765 43210' }], fleetRows: [{ rider_id: 'R2', rider_contact_number: '8765432109' }] }

test('dropdown preserves uploaded week labels and keeps accounting months separate', () => {
  const options = paymentWeekOptions([payment, payment, { ...payment, week: 'Advance', period_start: '2026-11-01' }, { ...payment, month: 'Oct-26', period_start: '2026-10-01' }])
  assert.equal(options.length, 3)
  assert.equal(options[0].label, '4626 · Nov-26')
  assert.equal(options[1].label, 'Advance · Nov-26')
  assert.notEqual(options[0].value, options[2].value)
})

test('raw payment week selection includes undated payments and excludes other months', () => {
  const rows = prepareWhatsappPayments([{ ...payment, period_start: null }, { ...payment, id: 2, month: 'Oct-26' }])
  const report = buildWhatsappReport(rows, { paymentWeek: paymentWeekKey(payment), contacts })
  assert.equal(report.length, 1)
  assert.equal(report[0].Orders, 10)
})

test('Client Mapping History resolves client and EV91 IDs, scopes city/client and prefers newest phone', () => {
  const mappingRows = [
    { clientId: 'R1', ev91RiderId: 'EV1', clientName: 'Client A', city: 'Bengaluru', phoneNumber: '9876543210', lastUpdated: '2026-11-01' },
    { clientId: 'R1', ev91RiderId: 'EV1', clientName: 'Client A', city: 'Bangalore', phoneNumber: '+91 87654 32109', lastUpdated: '2026-11-10' },
    { clientId: 'R1', clientName: 'Client B', city: 'Delhi', phoneNumber: '7654321098', lastUpdated: '2026-11-15' },
  ]
  for (const riderId of ['R1', 'EV1']) {
    const report = buildWhatsappReport(prepareWhatsappPayments([{ ...payment, rider_id: riderId }]), { paymentWeek: paymentWeekKey(payment), contacts: { mappingRows } })
    assert.equal(report[0].Mobnumber, '918765432109')
  }
  const report = buildWhatsappReport(prepareWhatsappPayments([payment]), { paymentWeek: paymentWeekKey(payment), contacts: { ...contacts, mappingRows } })
  assert.equal(report[0].Mobnumber, '919876543210', 'existing onboarding phone stays preferred')
  const wrongClient = buildWhatsappReport(prepareWhatsappPayments([{ ...payment, client_name: 'Client C' }]), { paymentWeek: paymentWeekKey(payment), contacts: { mappingRows } })
  assert.equal(wrongClient[0].Mobnumber, '')
})

test('dated paid records do not require a populated month', () => {
  const rows = prepareWhatsappPayments([{ ...payment, month: null }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].weekStart, '2026-11-09')
})

test('only Released qualifies, allowing case and surrounding whitespace', () => {
  for (const status of ['Released', ' released ', 'RELEASED']) assert.equal(isPayoutDone(status), true)
  for (const status of ['Release', 'Paid', 'PAYOUT_DONE', 'Payment Done', 'Completed', 'success', 'Settled', '', null, 'Unpaid', 'Not Paid', 'Pending', 'Failed', 'Payment not done', 'On Hold', 'On hold by city team', 'On hold by MIS team', 'Bank verification delayed', 'Wrong IFSC Code', 'Hold', 'Inactive riders', 'Incorrect PAN', 'On hold by Keerthana', 'Not Released']) assert.equal(isPayoutDone(status), false)
})

test('only Released records populate the selected week report', () => {
  const rows = prepareWhatsappPayments([
    { ...payment, payment_status: 'Released' },
    { ...payment, id: 2, payment_status: 'Release', orders: 5 },
    { ...payment, id: 3, payment_status: 'Hold', orders: 100 },
    { ...payment, id: 4, payment_status: '' },
  ])
  const report = buildWhatsappReport(rows, { paymentWeek: paymentWeekKey(payment), contacts })
  assert.equal(rows.length, 1)
  assert.equal(report.length, 1)
  assert.equal(report[0].Orders, 10)
  assert.equal(report[0].FinalNetPayout, 800)
  assert.equal(report[0].Others, 'NA')
})

test('weekly totals preserve requested columns, phone text and NA without other deductions', () => {
  const payments = prepareWhatsappPayments([payment, { ...payment, id: 2, orders: 5, final_net_payout: 0.25 }, { ...payment, id: 3, payment_status: 'Pending' }])
  const rows = buildWhatsappReport(payments, { week: '2026-11-09', contacts })
  assert.deepEqual(rows, [{ Mobnumber: '919876543210', 'Rider ID': 'R1', RiderName: 'Rider One', Orders: 15, COD_Deduction: 2000, Others: 'NA', EVrent: 400, FinalNetPayout: 800.25 }])
  assert.deepEqual(Object.keys(rows[0]), WHATSAPP_COLUMNS)
})

test('multiple clients and cities filter together and weeks never mix years', () => {
  const payments = prepareWhatsappPayments([
    payment,
    { ...payment, id: 2, rider_id: 'R2', client_name: 'Client B', city: 'Chennai' },
    { ...payment, id: 3, client_name: 'Client C' },
    { ...payment, id: 4, period_start: '2025-11-10' },
  ])
  const rows = buildWhatsappReport(payments, { week: '2026-11-09', clients: ['Client A', 'Client B'], cities: ['Bengaluru', 'Chennai'], contacts })
  assert.equal(rows.length, 2)
  assert.deepEqual(new Set(rows.map((row) => row.Mobnumber)), new Set(['919876543210', '918765432109']))
  assert.equal(buildWhatsappReport(payments, { week: '', contacts }).length, 0)
})

test('missing and ambiguous contacts remain visible without a guessed phone', () => {
  const rows = buildWhatsappReport(prepareWhatsappPayments([payment, { ...payment, id: 2, rider_id: 'missing' }]), {
    week: '2026-11-09', contacts: { onboardingRows: [
      { rider_id_details: 'R1', rider_mobile_number: '9876543210' },
      { rider_id_details: 'R1', rider_mobile_number: '8765432109' },
    ] },
  })
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.Mobnumber === ''))
})

test('FE5091655 matches a mapping with a missing client-name placeholder and matching city', () => {
  const paid = prepareWhatsappPayments([{ ...payment, rider_id: 'FE5091655', city: 'Mumbai', client_name: 'Actual Client' }])
  const mappingRows = [{ clientId: 'FE5091655', ev91RiderId: 'MUM-26-R000047', clientName: 'CLIENT NAME NOT FOUND', city: 'Mumbai', phoneNumber: '9876543210', lastUpdated: '2026-07-09T11:26:16.593Z' }]
  const rows = buildWhatsappReport(paid, { paymentWeek: paymentWeekKey(payment), contacts: { mappingRows } })
  assert.equal(rows[0].Mobnumber, '919876543210')
  assert.equal(rows[0]['Rider ID'], 'FE5091655')
  const differentCity = buildWhatsappReport(prepareWhatsappPayments([{ ...paid[0], city: 'Delhi' }]), { paymentWeek: paymentWeekKey(payment), contacts: { mappingRows } })
  assert.equal(differentCity[0].Mobnumber, '')
  const conflicting = buildWhatsappReport(paid, { paymentWeek: paymentWeekKey(payment), contacts: { mappingRows: [...mappingRows, { ...mappingRows[0], phoneNumber: '8765432109' }] } })
  assert.equal(conflicting[0].Mobnumber, '')
})
