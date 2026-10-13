export const TREND_VALUE_COLORS = { high: '#4ade80', mid: '#facc15', low: '#f87171' }

/** Compare the displayed periods within one row, excluding any aggregate total. */
export function clientPeriodValueLevels(periods, values) {
  const numbers = periods.map((period) => values[period] || 0)
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  return numbers.map((value) => {
    const position = max === min ? 0.5 : (value - min) / (max - min)
    return position <= 1 / 3 ? 'low' : position >= 2 / 3 ? 'high' : 'mid'
  })
}
