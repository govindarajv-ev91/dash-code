import { supabase } from './supabaseClient'

export async function fetchSourceMaster({ includeInactive = false } = {}) {
  const rows = []
  let cursor = null
  // Continue to an empty page even when the server caps responses below 1000.
  while (true) {
    let query = supabase.from('source_master')
      // Keep existing source lists readable before the contact-fields migration is applied.
      .select('*')
      .order('id', { ascending: true }).limit(1000)
    if (!includeInactive) query = query.eq('is_active', true)
    if (cursor !== null) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error) throw error
    if (!data?.length) return rows
    const next = data.at(-1).id
    if (next == null || String(next) === String(cursor)) throw new Error('Incomplete source list.')
    rows.push(...data)
    cursor = next
  }
}

export function sourceMasterError(error) {
  if (['42703', 'PGRST204'].includes(error?.code) && /email_id|phone_number/i.test(error.message || '')) return 'Run sql/add_source_master_email.sql in Supabase SQL Editor to enable Mail ID and phone number, then refresh and retry.'
  if (error?.code === '23505') return 'This source already exists in this city. Edit or reactivate the existing entry.'
  if (error?.code === 'PGRST116') return 'No source was changed. Refresh the list and retry. If the source still exists, run sql/fix_source_master_permissions.sql in Supabase to repair source-management permissions.'
  if (error?.code === '42501') {
    if (/permission denied for (?:table|relation|sequence)/i.test(error.message || '')) {
      return 'Source management database permissions are missing. Ask the project owner to run sql/fix_source_master_permissions.sql in Supabase SQL Editor, then refresh and retry. The status-only repair does not enable Add source.'
    }
    return 'Your current session is not allowed to change sources. Sign in again with an administrator account. If the error continues, run sql/fix_source_master_permissions.sql in Supabase.'
  }
  if (['PGRST301', 'PGRST303'].includes(error?.code) || error?.status === 401) return 'Your sign-in session has expired. Sign in again before changing sources.'
  if (['42P01', 'PGRST205'].includes(error?.code)) return 'Run sql/create_source_master.sql in Supabase, then refresh this page.'
  return error?.message || 'Unable to save source changes. Please try again.'
}

export async function saveSourceMaster({ id, city, source_name, email_id = '', phone_number = '', is_active = true }) {
  const cleanCity = String(city || '').trim().replace(/\s+/g, ' ')
  // Store the seeded spelling for city aliases to keep duplicate checks useful.
  const aliases = { bengaluru: 'Bangalore', bangalore: 'Bangalore', mysuru: 'Mysore', mysore: 'Mysore' }
  const values = {
    city: aliases[cleanCity.toLowerCase()] || cleanCity,
    source_name: String(source_name || '').trim().replace(/\s+/g, ' '),
    email_id: String(email_id || '').trim(),
    phone_number: String(phone_number || '').trim(),
    is_active: is_active === true,
  }
  if (!values.city || !values.source_name) throw new Error('City and source name are required.')
  if (values.email_id && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email_id)) throw new Error('Enter a valid Mail ID or leave it blank.')
  const query = id == null
    ? supabase.from('source_master').insert(values)
    : supabase.from('source_master').update(values).eq('id', id)
  const { data, error } = await query.select('id,city,source_name,email_id,phone_number,is_active').single()
  if (error) throw error
  return data
}

export async function setSourceMasterActive(id, isActive) {
  if (id == null) throw new Error('Choose a source first.')
  const { data, error } = await supabase.from('source_master')
    .update({ is_active: isActive === true }).eq('id', id)
    .select('id,city,source_name,is_active').single()
  if (error) throw error
  return data
}

export async function deleteSourceMaster(id) {
  if (id == null) throw new Error('Choose a source first.')
  const { error } = await supabase.from('source_master').delete().eq('id', id).select('id').single()
  if (error) throw error
}
