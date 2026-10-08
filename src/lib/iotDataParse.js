import * as XLSX from 'xlsx'
import { format } from 'date-fns'
import { IOT_SOURCE_TEMPLATES } from './iotUpload/sourceTemplates.js'

export {
  IOT_DATA_SOURCES, parseIotWorkbookArrayBuffer, parseIotWorkbookRows,
  detectIotDataSource, toIotDbRows, allowsMultiFilePerDate,
} from './iotUpload/iotDataParse.js'
export { attachVehicleLookup, attachEv91VehicleLookup } from './iotUpload/vehicleLookup.js'
export { IOT_SOURCE_TEMPLATES } from './iotUpload/sourceTemplates.js'
export { downloadUnmatchedVehicles } from './iotUpload/downloadCsv.js'

export function downloadIotDataTemplate(sourceKey) {
  const template = IOT_SOURCE_TEMPLATES[sourceKey]
  if (!template) return
  const sample = template.sampleRow.map((value, index) =>
    template.headers[index] === template.requiredFields.date ? format(new Date(), 'yyyy-MM-dd') : value
  )
  const sheet = XLSX.utils.aoa_to_sheet([template.headers, sample])
  sheet['!cols'] = template.headers.map((header) => ({ wch: Math.max(18, header.length + 2) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'IoT Upload')
  XLSX.writeFile(workbook, template.templateFile.replace(/\.csv$/, '.xlsx'))
}
