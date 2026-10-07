// Keep the old project's source values, including its historical Stridegreen/Motvolt mapping.
export const IOT_SOURCES = [
  { value: 'opspod_ev91', label: 'Opspod-ev91' },
  { value: 'alt_mobility', label: 'Alt Mobility' },
  { value: 'vehicle_day_report', label: 'Recent_Details (stridegreen)' },
  { value: 'Recent_Details', label: 'vehicle_day_report (Motvolt)' },
]

export function formatIotSource(value) {
  return IOT_SOURCES.find((source) => source.value === value)?.label || value || '—'
}
