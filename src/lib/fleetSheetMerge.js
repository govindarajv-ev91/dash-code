export const FLEET_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQcqousIenx7wOzlCIB6rw0zSXnfiwmWyXPcTzYoDX5E9PryySAoMLMjiWNdlVg8vYWUIX3iqM4VG0D/pub?gid=721267187&single=true&output=csv'

export const normalizeHeader = (value) =>
  (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, '')
    .replace(/[^a-z0-9]/g, '')

export const headerToSnakeCase = (header) =>
  (header || '')
    .toString()
    .trim()
    .replace(/\uFEFF/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

// Explicit sheet header → DB column map (from published Google Sheet labels)
const SHEET_HEADER_TO_DB = {
  timestamp: 'keerthana_tc_chenai_tn',
  emailaddress: 'email_address',
  citylocations: 'city_locations',
  date: 'date_record',
  vehiclenumber: 'vehicle_number',
  pancard: 'pan_card',
  riderid: 'rider_id',
  ridername: 'rider_name',
  ridercontactnumber: 'rider_contact_number',
  clientname: 'client_name',
  hublocation: 'hub_location',
  category: 'category',
  vehiclestatus: 'vehicle_status',
  vehicledeployedatdeployed: 'vehicle_deployed_at_deployed',
  nomineenamedeployee: 'nominee_name_deployee',
  nomineephonenumberdeployee: 'nominee_phone_number_deployee',
  rideralternatephonenumberdeployee: 'rider_alternate_phone_number_deployee',
  bgvstatusdeployee: 'bgv_status_deployee',
  ticketidbgv: 'ticket_id_bgv',
  securitydeposittotaldeployee: 'security_deposit_total_deployee',
  securitydepositpaiddeployee: 'security_deposit_paid_deployee',
  sdpaidutrdeployee: 'sd_paid_utr_deployee',
  securitydepositpendingdeployee: 'security_deposit_pending_deployee',
  sdamountpaidscreenshotdeployee: 'sd_amount_paid_screenshot_deployee',
  deployedagreementphotodeployee: 'deployed_agreement_photo_deployee',
  originaldocumenttobesubmitteddeployee: 'original_document_to_be_submitted_deployee',
  imageoforiginaldocumentsubmitteddeployee: 'image_of_original_document_submitted_deployee',
  warehouselocation: 'warehouse_location',
  reasonforreturning: 'reason_for_returning',
  exactreasonforreturningremarks: 'exact_reason_for_returning_remarks',
  trafficfinereturning: 'traffic_fine_returning',
  istheoriginaldocsreturned: 'is_the_original_doc_s_returned',
  docimagedocwithriderimagereturnreturning: 'doc_image_doc_with_rider_image_return_returning',
  rentpendingreturning: 'rent_pending_returning',
  vehicleconditionreturning: 'vehicle_condition_returning',
  sourcenamevehicleassetdetails: 'source_name_vehicle_asset_details',
  chargernumbervehicleassetdetails: 'charger_number_vehicle_asset_details',
  batterynumbervehicleassetdetails: 'battery_number_vehicle_asset_details',
  chargerimagevehicleassetdetails: 'charger_image_vehicle_asset_details',
  batteryimagevehicleassetdetails: 'battery_image_vehicle_asset_details',
  vehicleimagevideowithriderfrontbackleftrightvehicleassetdetails:
    'vehicle_image_video_with_rider_front_back_left_right_ve',
  kmsvehicleassetdetails: 'kms_vehicle_asset_details',
  remarksvehicleassetdetails: 'remarks_vehicle_asset_details',
  ifdamageforvehiclereturning: 'if_damage_for_vehicle_returning',
  nomineenamebgv: 'nominee_name_bgv',
  nomineecontactnumberbgv: 'nominee_contact_number_bgv',
  permanentaddressbgv: 'permanent_address_bgv',
  presentaddress: 'present_address',
  gmaplocation: 'g_map_location',
  homeimagewithrider: 'home_image_with_rider',
  localaddressproofmandatoryelectricitybillorrentagreement:
    'local_address_proof_mandatory_electricity_bill_or_rent',
  partnamechargerandbatteryswaping: 'part_name_charger_and_battery_swaping',
  kmchargerandbatteryswaping: 'km_charger_and_battery_swaping',
  partnumberchargerandbatteryswaping: 'part_number_charger_and_battery_swaping',
  failurepartvideochargerandbatteryswaping: 'failure_part_video_charger_and_battery_swaping',
  swapingstatus: 'swaping_status',
  ifanypartsdamagechargerandbatteryswaping: 'if_any_parts_damage_charger_and_battery_swaping',
  ticketid: 'ticket_id',
  techniciannameservicedone: 'technician_name_service_done',
  servicestatus: 'service_status',
  reason: 'reason',
  kmservicedone: 'km_service_done',
  issueexplanationservicedone: 'issue_explanation_service_done',
  replacedpartsnameservicedone: 'replaced_parts_name_service_done',
  ifvehicledamageservicedone: 'if_vehicle_damage_service_done',
  damagepartnamevehicledamageform: 'damage_part_name_vehicle_damage_form',
  damagephotosvehicledamageform: 'damage_photos_vehicle_damage_form',
  totaldamageamountvehicledamageform: 'total_damage_amount_vehicle_damage_form',
  paidamountvehicledamageform: 'paid_amount_vehicle_damage_form',
  pendingamountvehicledamageform: 'pending_amount_vehicle_damage_form',
  utrnumbervehicledamageform: 'utr_number_vehicle_damage_form',
  utrscreenshotvehicledamageform: 'utr_screenshot_vehicle_damage_form',
  remarksvehicledamageform: 'remarks_vehicle_damage_form',
  formfilledbyvehicledamageform: 'form_filled_by_vehicle_damage_form',
  totalsdcollectedsdrefundrequest: 'total_sd_collected_sd_refund_request',
  banknamesdrefundrequest: 'bank_name_sd_refund_request',
  bankaccountnumbersdrefundrequest: 'bank_account_number_sd_refund_request',
  bankifscodesdrefundrequest: 'bank_ifsc_code_sd_refund_request',
  bikedeployeddatesdrefundrequest: 'bike_deployed_date_sd_refund_request',
  bikereturndatesdrefundrequest: 'bike_return_date_sd_refund_request',
  rentpendingsdrefundrequest: 'rent_pending_sd_refund_request',
  trafficfinesdrefundrequest: 'traffic_fine_sd_refund_request',
  vehicledamageamountsdrefundrequest: 'vehicle_damage_amount_sd_refund_request',
  servicecostsdrefundrequest: 'service_cost_sd_refund_request',
  bankpassbookphotosdrefundrequest: 'bank_passbook_photo_sd_refund_request',
  ticket: 'ticket',
  sourcename: 'source_name',
  rentpending: 'rent_pending',
  kmsbeforeservice: 'km_s_before_service',
  vehicleimageorvideoonroadservice: 'vehicle_image_or_video_onroad_service',
  issuetypeonroadservice: 'issue_type_onroad_service',
  vehiclepartnumberonroadservice: 'vehicle_part_number_onroad_service',
  issueexplanationonroadservice: 'issue_explanation_onroad_service',
  finalremarksonroadservice: 'final_remarks_onroad_service',
  proofphotos: 'proof_photos',
  anypendingamountdamageandrent: 'any_pending_amount_damage_and_rent',
  location: 'location',
  rentamount: 'rent_amount',
  damagetrafficfineamount: 'damage_traffic_fine_amount',
  paymentstatus: 'payment_status',
  utrnumber1: 'utr_number_1',
  utrnumber2: 'utr_number_2',
  paymenttype: 'payment_type',
  utrandcashphoto: 'utr_and_cash_photo',
  filledby: 'filled_by',
  remarks: 'remarks',
}

export const parseCSV = (text) => {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++
      row.push(field)
      field = ''
      if (row.some((cell) => (cell || '').trim() !== '')) rows.push(row)
      row = []
      continue
    }

    field += ch
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((cell) => (cell || '').trim() !== '')) rows.push(row)
  }

  return rows
}

const normalizeParsedRows = (parsed) => {
  if (!parsed.length) return parsed
  if (parsed[0].length === 1 && parsed[0][0].includes('\t')) {
    return parsed.map((r) => r[0].split('\t'))
  }
  return parsed
}

const resolveHeaderKey = (header, dbKeyMap) => {
  const norm = normalizeHeader(header)
  if (SHEET_HEADER_TO_DB[norm]) return SHEET_HEADER_TO_DB[norm]
  if (dbKeyMap.has(norm)) return dbKeyMap.get(norm)

  const snake = headerToSnakeCase(header)
  if (dbKeyMap.has(normalizeHeader(snake))) return dbKeyMap.get(normalizeHeader(snake))
  if (dbKeyMap.has(snake)) return snake
  return snake || null
}

export const mapGoogleSheetRowsToFleetKeys = (csvText, dbSampleKeys = []) => {
  let parsed = normalizeParsedRows(parseCSV(csvText))
  if (!parsed.length) return { rows: [], matchedHeaders: 0, totalHeaders: 0 }

  const headers = parsed[0].map((h) => (h || '').toString().trim())
  const dbKeyMap = new Map()
  dbSampleKeys.forEach((k) => {
    dbKeyMap.set(normalizeHeader(k), k)
    dbKeyMap.set(k, k)
  })

  const headerToDbKey = headers.map((header) => resolveHeaderKey(header, dbKeyMap))
  const matchedHeaders = headerToDbKey.filter(Boolean).length

  const rows = []
  for (let i = 1; i < parsed.length; i++) {
    const cols = parsed[i]
    const mapped = { data_source: 'Google Sheet' }
    let hasData = false

    for (let c = 0; c < headerToDbKey.length; c++) {
      const key = headerToDbKey[c]
      if (!key) continue
      const raw = cols[c]
      const val = raw == null ? '' : raw.toString().trim()
      if (val !== '') {
        mapped[key] = val
        hasData = true
      }
    }

    if (hasData) {
      if (!mapped.id) mapped.id = `gsheet-${i}`
      rows.push(mapped)
    }
  }

  return { rows, matchedHeaders, totalHeaders: headers.length }
}

const isValidCsvPayload = (text) => {
  if (!text || text.length < 20) return false
  const start = text.trim().slice(0, 200).toLowerCase()
  if (start.startsWith('<!doctype') || start.startsWith('<html')) return false
  return text.includes(',') || text.includes('\t')
}

export const fetchFleetSheetCsv = async () => {
  const devProxyUrl = '/api/fleet-sheet-csv'
  const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(FLEET_SHEET_CSV_URL)}`

  const candidates = [
    import.meta.env.DEV ? devProxyUrl : null,
    FLEET_SHEET_CSV_URL,
    corsProxyUrl,
  ].filter(Boolean)

  let lastError = null
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} for ${url}`)
        continue
      }
      const text = await res.text()
      if (!isValidCsvPayload(text)) {
        lastError = new Error(`Invalid CSV payload from ${url}`)
        continue
      }
      return text
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('Failed to fetch Google Sheet CSV')
}
