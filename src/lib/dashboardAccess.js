import { supabase } from './supabaseClient'
import { adminServiceError } from './adminServiceError'

export const dashboardAccess = {
  async getLoginEnabled() {
    const { data, error } = await supabase.rpc('dashboard_login_enabled')
    if (error || typeof data !== 'boolean') throw new Error('Login settings are unavailable. Contact your administrator.')
    return data
  },
  async getProfile(userId) {
    const { data, error } = await supabase.from('dashboard_users')
      .select('id,email,display_name,role').eq('id', userId).maybeSingle()
    if (error) throw new Error('Your account could not be checked. Please try again.')
    return data
  },
  async setLoginEnabled(enabled) {
    const { data, error } = await supabase.rpc('set_dashboard_login_enabled', { p_enabled: enabled })
    if (error) {
      if (error.code === '42501') throw new Error('Only administrators can change the sign-in setting.')
      if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Sign-in settings are not installed yet. Ask your administrator to complete the setup.')
      throw new Error('The sign-in setting could not be saved. Please try again.')
    }
    if (typeof data !== 'boolean') throw new Error('The sign-in setting could not be confirmed. Please try again.')
    return data
  },
  async adminAction(body) {
    const { data, error } = await supabase.functions.invoke('dashboard-admin', { body })
    if (error) {
      throw await adminServiceError(error)
    }
    if (data?.error) throw new Error(data.error)
    if (!data) throw new Error('The admin service returned no response.')
    return data
  },
}
