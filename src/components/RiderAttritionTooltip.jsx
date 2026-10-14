export default function RiderAttritionTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.8rem' }}>
      <p style={{ margin: '0 0 0.5rem', color: 'var(--text-dim)' }}>
        {label}{point.periodStatus === 'In progress' ? ' · In progress' : ''}
      </p>
      {payload.map((entry) => {
        const percent = point[`${entry.dataKey}AttritionPercent`]
        return (
          <p key={entry.dataKey} style={{ margin: '0.3rem 0', color: entry.color }}>
            {entry.name}: <strong>{Number(entry.value).toLocaleString('en-IN')} ({percent == null ? 'N/A' : `${percent.toFixed(2)}%`})</strong>
          </p>
        )
      })}
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
        Base: {point.basePeriod} working riders · EV {point.evRiderBase.toLocaleString('en-IN')} · Non-EV {point.nonEvRiderBase.toLocaleString('en-IN')} · Total {point.totalRiderBase.toLocaleString('en-IN')}
      </p>
    </div>
  )
}
