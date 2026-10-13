import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' })
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event']) {
  globalThis[name] = name === 'window' ? dom.window : dom.window[name]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({
  cacheDir: 'node_modules/.vite-tests/auth',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{
    name: 'no-live-auth', enforce: 'pre',
    transform(_code, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/lib/supabaseClient.js')) {
        return 'export const supabase = { auth: {} }'
      }
    },
  }],
})
const { default: AuthenticatedApp } = await server.ssrLoadModule('/src/components/AuthenticatedApp.jsx')
const { default: AccountMenu } = await server.ssrLoadModule('/src/components/AccountMenu.jsx')
const { default: AdminPage } = await server.ssrLoadModule('/src/components/AdminPage.jsx')
after(async () => {
  await server.close()
  dom.window.close()
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[name]
})
const session = { user: { id: 'staff-1', email: 'staff@example.com' } }
function mockAuth(initial = null) {
  let listener
  return {
    unsubscribed: false,
    onAuthStateChange(callback) {
      listener = callback
      return { data: { subscription: { unsubscribe: () => { this.unsubscribed = true } } } }
    },
    getSession: async () => ({ data: { session: initial }, error: null }),
    emit(event, value) { listener(event, value) },
    async signInWithPassword(credentials) {
      this.credentials = credentials
      this.emit('SIGNED_IN', session)
      return { data: { session }, error: null }
    },
    async signOut(options) {
      this.signOutOptions = options
      this.emit('SIGNED_OUT', null)
      return { error: null }
    },
  }
}
const mockAccess = (enabled = true, role = 'user') => ({
  getLoginEnabled: async () => enabled,
  getProfile: async (id) => ({ id, role }),
})
async function mount(t, auth, access = mockAccess(), hash = '') {
  window.history.replaceState(null, '', `/${hash}`)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let mounts = 0
  function Dashboard(props) {
    mounts++
    return createElement('section', { 'data-dashboard': true }, 'Fleet dashboard', createElement(AccountMenu, props))
  }
  function Admin() { return createElement('div', { 'data-admin': true }, 'Admin tools') }
  await act(async () => root.render(createElement(AuthenticatedApp, { auth, access, DashboardComponent: Dashboard, AdminComponent: Admin })))
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  return { container, root, mounts: () => mounts }
}
function fill(container, selector, value) {
  const input = container.querySelector(selector)
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
async function submit(container) {
  await act(async () => {
    fill(container, '#login-email', 'staff@example.com')
    fill(container, '#login-password', '  secret password  ')
  })
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

test('dashboard never mounts before restoration or when signed out', async (t) => {
  const auth = mockAuth()
  let finish
  auth.getSession = () => new Promise((resolve) => { finish = resolve })
  const view = await mount(t, auth)
  assert.match(view.container.textContent, /Checking your session/)
  assert.equal(view.mounts(), 0)
  await act(async () => finish({ data: { session: null }, error: null }))
  assert.ok(view.container.querySelector('form'))
  assert.equal(view.mounts(), 0)
})
test('email login submits exact password and logout returns to login', async (t) => {
  const auth = mockAuth()
  const { container } = await mount(t, auth)
  await submit(container)
  assert.deepEqual(auth.credentials, { email: 'staff@example.com', password: '  secret password  ' })
  assert.ok(container.querySelector('[data-dashboard]'))
  assert.match(container.textContent, /staff@example.com/)
  await act(async () => container.querySelector('.account-menu button').click())
  assert.deepEqual(auth.signOutOptions, { scope: 'local' })
  assert.equal(container.querySelector('[data-dashboard]'), null)
  assert.ok(container.querySelector('#login-password'))
  assert.equal(container.querySelector('#login-password').value, '')
})
test('saved session opens dashboard and remote sign-out removes it', async (t) => {
  const auth = mockAuth(session)
  const { container } = await mount(t, auth)
  assert.ok(container.querySelector('[data-dashboard]'))
  await act(async () => auth.emit('SIGNED_OUT', null))
  assert.equal(container.querySelector('[data-dashboard]'), null)
})
test('old session response cannot undo a newer sign-out', async (t) => {
  const auth = mockAuth()
  let finish
  auth.getSession = () => new Promise((resolve) => { finish = resolve })
  const { container } = await mount(t, auth)
  await act(async () => auth.emit('SIGNED_OUT', null))
  await act(async () => finish({ data: { session }, error: null }))
  assert.ok(container.querySelector('form'))
  assert.equal(container.querySelector('[data-dashboard]'), null)
})
test('bad credentials and network errors keep dashboard closed and allow retry', async (t) => {
  const auth = mockAuth()
  auth.signInWithPassword = async () => ({ error: { code: 'invalid_credentials' } })
  const view = await mount(t, auth)
  await submit(view.container)
  assert.match(view.container.querySelector('[role="alert"]').textContent, /email or password is incorrect/)
  assert.equal(view.mounts(), 0)
  auth.signInWithPassword = async () => { throw new Error('offline') }
  await submit(view.container)
  assert.match(view.container.querySelector('[role="alert"]').textContent, /Check your connection/)
  assert.equal(view.container.querySelector('[type="submit"]').disabled, false)
})
test('session failure shows login with recoverable error; password visibility toggles', async (t) => {
  const auth = mockAuth()
  auth.getSession = async () => { throw new Error('offline') }
  const { container } = await mount(t, auth)
  assert.match(container.querySelector('[role="alert"]').textContent, /session could not be restored/)
  assert.equal(container.querySelector('#login-password').type, 'password')
  await act(async () => container.querySelector('[aria-label="Show password"]').click())
  assert.equal(container.querySelector('#login-password').type, 'text')
  await act(async () => container.querySelector('[aria-label="Hide password"]').click())
  assert.equal(container.querySelector('#login-password').type, 'password')
})
test('failed logout preserves dashboard and exposes retry', async (t) => {
  const auth = mockAuth(session)
  auth.signOut = async () => ({ error: new Error('offline') })
  const { container } = await mount(t, auth)
  await act(async () => container.querySelector('.account-menu button').click())
  assert.ok(container.querySelector('[data-dashboard]'))
  assert.match(container.querySelector('[role="alert"]').textContent, /Unable to sign out/)
  assert.equal(container.querySelector('.account-menu button').disabled, false)
})
test('anonymous Supabase sessions cannot enter and subscription cleans up', async (t) => {
  const auth = mockAuth({ user: { ...session.user, is_anonymous: true } })
  const view = await mount(t, auth)
  assert.equal(view.mounts(), 0)
  await act(async () => view.root.unmount())
  assert.equal(auth.unsubscribed, true)
})

test('disabled login opens dashboard without a session but admin route still requires sign-in', async (t) => {
  const publicView = await mount(t, mockAuth(), mockAccess(false))
  assert.ok(publicView.container.querySelector('[data-dashboard]'))
  assert.equal(publicView.container.querySelector('form'), null)
  await act(async () => publicView.root.unmount())
  const adminView = await mount(t, mockAuth(), mockAccess(false), '#admin')
  assert.match(adminView.container.textContent, /Admin sign in/)
  assert.equal(adminView.mounts(), 0)
  assert.equal(adminView.container.querySelector('[data-admin]'), null)
})
test('ordinary signed-in users cannot open admin tools while login is disabled', async (t) => {
  const { container } = await mount(t, mockAuth(session), mockAccess(false), '#admin')
  assert.match(container.textContent, /Administrator access required/)
  assert.equal(container.querySelector('[data-admin]'), null)
})
test('database admin role allows opening admin tools', async (t) => {
  const { container } = await mount(t, mockAuth(session), mockAccess(true, 'admin'), '#admin')
  assert.ok(container.querySelector('[data-admin]'))
  assert.equal(container.querySelector('[data-dashboard]'), null)
})
test('unavailable login settings fail closed rather than grant public access', async (t) => {
  const access = mockAccess(false)
  access.getLoginEnabled = async () => { throw new Error('missing table') }
  const view = await mount(t, mockAuth(), access)
  assert.equal(view.mounts(), 0)
  assert.match(view.container.querySelector('[role="alert"]').textContent, /Login settings are unavailable/)
})
test('deleted account has no access when login is enabled', async (t) => {
  const access = mockAccess()
  access.getProfile = async () => null
  const view = await mount(t, mockAuth(session), access)
  assert.equal(view.mounts(), 0)
  assert.match(view.container.textContent, /Account unavailable/)
})
test('enabling login removes the public dashboard when settings refresh', async (t) => {
  let enabled = false
  const access = mockAccess()
  access.getLoginEnabled = async () => enabled
  const view = await mount(t, mockAuth(), access)
  assert.ok(view.container.querySelector('[data-dashboard]'))
  enabled = true
  await act(async () => window.dispatchEvent(new Event('focus')))
  assert.equal(view.container.querySelector('[data-dashboard]'), null)
  assert.ok(view.container.querySelector('form'))
})

test('admin form creates users, confirms deletion, and confirms making dashboard public', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  const calls = []
  let list = [{ id: 'staff-1', email: 'staff@example.com', role: 'user', display_name: 'Staff' },
    { id: 'admin-1', email: 'admin@example.com', role: 'admin', display_name: 'Admin' }]
  let enabled = true
  const access = {
    async setLoginEnabled(value) { calls.push({ action: 'set-login-enabled', login_enabled: value }); return value },
    async adminAction(body) {
      calls.push(body)
      if (body.action === 'list-users') return { users: list, total: list.length }
      if (body.action === 'create-user') { list = [...list, { id: 'staff-2', email: body.email, role: 'user' }]; return { user: list.at(-1) } }
      if (body.action === 'delete-user') { list = list.filter((account) => account.id !== body.user_id); return { deleted: true } }
      return { login_enabled: body.login_enabled }
    },
  }
  const render = () => root.render(createElement(AdminPage, {
    user: { id: 'admin-1', email: 'admin@example.com' }, access, loginEnabled: enabled,
    onLoginSettingChange(value) { enabled = value; render() },
  }))
  await act(async () => render())
  assert.equal(container.querySelector('#login-settings-tab').getAttribute('aria-selected'), 'true')
  assert.equal(calls.length, 0, 'Sign-in settings must not require the account-management Edge Function')
  await act(async () => container.querySelector('#user-management-tab').click())
  assert.equal(container.querySelector('[aria-label="Delete admin@example.com"]'), null)
  await act(async () => {
    fill(container, '[name="email"]', 'new@example.com')
    fill(container, '[name="password"]', 'new-secret')
    fill(container, '[name="display_name"]', 'New user')
  })
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.deepEqual(calls.find((call) => call.action === 'create-user'), {
    action: 'create-user', email: 'new@example.com', password: 'new-secret', display_name: 'New user',
  })
  assert.equal(container.querySelector('[name="password"]').value, '')
  assert.match(container.textContent, /new@example.com/)
  await act(async () => container.querySelector('[aria-label="Delete staff@example.com"]').click())
  assert.equal(calls.some((call) => call.action === 'delete-user'), false)
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Confirm delete user').click())
  assert.ok(calls.some((call) => call.action === 'delete-user' && call.user_id === 'staff-1'))
  assert.doesNotMatch(container.querySelector('table').textContent, /staff@example.com/)
  await act(async () => container.querySelector('#login-settings-tab').click())
  await act(async () => container.querySelector('[role="switch"]').click())
  assert.equal(calls.some((call) => call.action === 'set-login-enabled'), false)
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Confirm disable login').click())
  assert.equal(enabled, false)
  assert.equal(container.querySelector('[role="switch"]').getAttribute('aria-checked'), 'false')
  await act(async () => container.querySelector('[role="switch"]').click())
  assert.equal(enabled, true)
})

test('sign-in settings work without account service and retain saved state on failure', async (t) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  let writes = 0
  let changes = 0
  const access = {
    adminAction() { throw new Error('Account service must not be called on the settings tab') },
    async setLoginEnabled() { writes++; throw new Error('Only administrators can change the sign-in setting.') },
  }
  await act(async () => root.render(createElement(AdminPage, {
    user: { id: 'admin', email: 'admin@example.com' }, access, loginEnabled: true,
    onLoginSettingChange() { changes++ },
  })))
  await act(async () => container.querySelector('[role="switch"]').click())
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Confirm disable login').click())
  assert.equal(writes, 1)
  assert.equal(changes, 0)
  assert.equal(container.querySelector('[role="switch"]').getAttribute('aria-checked'), 'true')
  assert.match(container.querySelector('[role="alert"]').textContent, /Only administrators/)
  assert.equal(container.querySelector('[role="switch"]').disabled, false)
})
