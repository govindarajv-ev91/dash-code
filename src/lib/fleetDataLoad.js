import {
  FLEET_FORM_SOURCE,
  FLEET_LEGACY_SOURCE,
} from './fleetDataConfig'

export function tagLegacyFleetRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    data_source: FLEET_LEGACY_SOURCE,
  }))
}

export function tagFormFleetRows(rows) {
  return (rows || []).map((row) => ({
    ...row,
    data_source: FLEET_FORM_SOURCE,
  }))
}

export function mergeFleetSources(legacyRows, formRows) {
  return [...tagLegacyFleetRows(legacyRows), ...tagFormFleetRows(formRows)]
}

export function splitFleetBySource(fleetRows) {
  const rows = fleetRows || []
  return {
    legacy: rows.filter((r) => (r.data_source || FLEET_LEGACY_SOURCE) !== FLEET_FORM_SOURCE),
    form: rows.filter((r) => r.data_source === FLEET_FORM_SOURCE),
  }
}
