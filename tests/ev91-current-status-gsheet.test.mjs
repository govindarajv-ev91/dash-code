import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const scripts = [
  ['scripts/ev91-current-status-gsheet.gs', 'preferOnboardingSources_'],
  ['scripts/google-sheets-ev91-current-status.gs', 'fillMissingSources_'],
]

function loadScript(path, onboardingRows) {
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    Logger: { log() {} },
  })
  vm.runInContext(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), context)
  context.fetchJsonArray_ = (url) => {
    const params = new URL(url).searchParams
    const cursor = (params.get('id') || '').replace(/^gt\./, '')
    return onboardingRows.filter((row) => !cursor || row.id > cursor).slice(0, 1000)
  }
  return context
}

const otherSanthosh = {
  id: '0823b139-972f-41a0-b6b5-b9e8c1beeace',
  rider_id_details: 'FE11083660',
  merge: 'voiceFE11083660',
  rider_name: 'Santhosh',
  rider_mobile_number: '9113579053',
  source_name: 'Jaffer_FR_Blr',
}

for (const [path, resolver] of scripts) {
  test(`${path}: unrelated Santhosh must not supply FE11893572's source`, () => {
    const script = loadScript(path, [otherSanthosh])
    const index = script.buildOnboardingSourceIndex_()
    const rider = {
      clientRiderId: 'FE11893572',
      ev91RiderId: 'CHE-26-R002008',
      riderName: 'Santhosh',
      riderContact: '9345889303',
    }
    for (const source of ['-', '', 'vignesh@ev91riderz.com']) {
      assert.equal(script[resolver]([{ ...rider, source }], index)[0].source, source)
    }
  })

  test(`${path}: exact IDs, voice merge IDs, and full phone numbers still match`, () => {
    const script = loadScript(path, [
      otherSanthosh,
      { id: 'b', merge: 'voiceFE11893572', source_name: 'Correct source' },
      { id: 'c', rider_id_details: '9876543210', source_name: 'Phone source' },
    ])
    const index = script.buildOnboardingSourceIndex_()
    for (const clientRiderId of ['FE11083660', ' fe-11083660 ']) {
      assert.equal(script[resolver]([{ clientRiderId, source: '-' }], index)[0].source, 'Jaffer_FR_Blr')
    }
    assert.equal(script[resolver]([{ clientRiderId: 'FE11893572', source: '-' }], index)[0].source, 'Correct source')
    assert.equal(script[resolver]([{ ev91RiderId: 'FE11083660', source: '-' }], index)[0].source, 'Jaffer_FR_Blr')
    assert.equal(script[resolver]([{ riderContact: '+91 91135 79053', source: '-' }], index)[0].source, 'Jaffer_FR_Blr')
    assert.equal(script[resolver]([{ riderContact: '9876543210', source: '-' }], index)[0].source, 'Phone source')
    assert.equal(script[resolver]([{ source: 'API source' }], index)[0].source, 'API source')
    const source = script[resolver]([{ clientRiderId: 'FE11083660', source: 'API source' }], index)[0].source
    assert.equal(source, resolver === 'preferOnboardingSources_' ? 'Jaffer_FR_Blr' : 'API source')
  })

  test(`${path}: IDs must not collide through stripped prefixes or phone suffixes`, () => {
    const script = loadScript(path, [
      { id: 'a', rider_id_details: 'OTHER11893572', source_name: 'Wrong prefix' },
      { id: 'b', rider_id_details: 'FE9113579053', source_name: 'Not a phone' },
      { id: 'c', rider_id_details: '12349113579053', source_name: 'Long ID' },
      { id: 'd', rider_mobile_number: '893572', source_name: 'Short phone' },
    ])
    const index = script.buildOnboardingSourceIndex_()
    for (const rider of [
      { clientRiderId: 'FE11893572' },
      { riderContact: '9113579053' },
      { riderContact: '893572' },
      { clientRiderId: 'FE9911893572' },
    ]) {
      assert.equal(script[resolver]([{ ...rider, source: '-' }], index)[0].source, '-')
    }
  })

  test(`${path}: conflicting duplicate IDs or phones do not pick the first source`, () => {
    const script = loadScript(path, [
      otherSanthosh,
      { ...otherSanthosh, id: 'b', source_name: 'Different source' },
      { ...otherSanthosh, id: 'c' },
    ])
    const index = script.buildOnboardingSourceIndex_()
    for (const rider of [{ clientRiderId: 'FE11083660' }, { riderContact: '9113579053' }]) {
      assert.equal(script[resolver]([{ ...rider, source: '-' }], index)[0].source, '-')
    }
  })

  test(`${path}: pagination advances over an entire page without source names`, () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: String(i + 1).padStart(5, '0'), source_name: '-' }))
    rows.push({ id: '01001', rider_id_details: 'FE11893572', source_name: 'Last page source' })
    const script = loadScript(path, rows)
    const index = script.buildOnboardingSourceIndex_()
    assert.equal(script[resolver]([{ clientRiderId: 'FE11893572', source: '-' }], index)[0].source, 'Last page source')
  })
}
