export const MAIL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function emailList(value, required = false) {
  const emails = [...new Set(String(value || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))]
  if ((required && !emails.length) || emails.some((email) => !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email))) {
    throw new Error('Enter valid email addresses separated by commas.')
  }
  if (emails.length > 40) throw new Error('Use at most 40 addresses per field.')
  return emails.join(',')
}

export function scheduleTime(hour, minute, meridiem) {
  if (!/^([1-9]|1[0-2])$/.test(String(hour)) || !/^\d{2}$/.test(String(minute)) || Number(minute) > 59 || !['AM', 'PM'].includes(meridiem)) throw new Error('Choose a valid hour, minute and AM/PM.')
  return `${String(Number(hour) % 12 + (meridiem === 'PM' ? 12 : 0)).padStart(2, '0')}:${minute}`
}

// A delayed trigger catches up only within the same IST day. Never send before
// a new schedule was created, or replay last week's schedule after downtime.
export function scheduleDue(schedule, now = new Date()) {
  if (!schedule.is_active) return false
  const ist = new Date(now.getTime() + 19800000)
  const date = ist.toISOString().slice(0, 10)
  const time = String(schedule.send_time).slice(0, 5)
  if (schedule.day_of_week !== null && schedule.day_of_week !== ist.getUTCDay()) return false
  if (ist.toISOString().slice(11, 16) < time) return false
  return new Date(`${date}T${time}:00+05:30`).getTime() >= new Date(schedule.updated_at || schedule.created_at).getTime()
}
