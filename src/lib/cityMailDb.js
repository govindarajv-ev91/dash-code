import { supabase } from './supabaseClient'
import { normalizeSummaryCity } from './citySummaryAliases.js'
import { emailList } from './cityMailSettings.js'

export function cityMailError(error) {
  if (['42P01', 'PGRST205'].includes(error?.code)) return 'Run sql/create_city_mail_settings.sql in Supabase SQL Editor, then refresh.'
  if (error?.code === '23505') return 'This city contact or schedule already exists. Edit the existing entry.'
  if (error?.code === '42501') return 'Sign in as a dashboard administrator to manage city email settings.'
  return error?.message || 'Unable to load or save city email settings.'
}

export async function fetchMailRows(table) {
  const rows = []
  let cursor = null
  while (true) {
    let query = supabase.from(table).select('*').order('id').limit(500)
    if (cursor !== null) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw error
    if (!data?.length) return rows
    const next = data.at(-1).id
    if (String(next) === String(cursor)) throw new Error('Incomplete city email settings.')
    rows.push(...data); cursor = next
  }
}

export async function saveCityContact(form) {
  const city = normalizeSummaryCity(form.city)
  if (!form.city?.trim() || ['All', 'Unknown'].includes(city)) throw new Error('Enter one city.')
  const values = { city, name: form.name.trim(), email_id: emailList(form.email_id, true), cc: emailList(form.cc), phone_number: form.phone_number.trim() }
  if (!values.name) throw new Error('Enter the contact name.')
  const query = form.id == null ? supabase.from('city_mail_contacts').insert(values) : supabase.from('city_mail_contacts').update(values).eq('id', form.id)
  const { error } = await query.select('id').single()
  if (error) throw error
}

export async function saveMailSchedule(form) {
  const values = { contact_id: form.contact_id, day_of_week: form.day_of_week === '' ? null : Number(form.day_of_week), send_time: form.send_time, is_active: form.is_active }
  const query = form.id == null ? supabase.from('client_period_mail_schedules').insert(values) : supabase.from('client_period_mail_schedules').update(values).eq('id', form.id)
  const { error } = await query.select('id').single()
  if (error) throw error
}
