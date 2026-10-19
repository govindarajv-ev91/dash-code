import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSourceMaster } from './sourceMasterDb'
import { buildSourceMasterIndex } from './sourceMaster'

export function useSourceMaster() {
  const [result, setResult] = useState({ rows: [], loading: true, error: '' })
  const generation = useRef(0)
  const refreshSources = useCallback(async () => {
    const request = ++generation.current
    setResult({ rows: [], loading: true, error: '' })
    try {
      const rows = await fetchSourceMaster()
      if (request === generation.current) setResult({ rows, loading: false, error: '' })
    } catch {
      if (request === generation.current) setResult({ rows: [], loading: false,
        error: 'Unable to load the source list. Run sql/create_source_master.sql in Supabase, then refresh sources. Exports still include all sources.' })
    }
  }, [])
  useEffect(() => {
    let active = true
    Promise.resolve().then(() => { if (active) refreshSources() })
    window.addEventListener('focus', refreshSources)
    return () => {
      active = false
      generation.current += 1
      window.removeEventListener('focus', refreshSources)
    }
  }, [refreshSources])
  const sourceIndex = useMemo(() => buildSourceMasterIndex(result.rows), [result.rows])
  return { sourceIndex, sourcesLoading: result.loading, sourceError: result.error, refreshSources }
}
