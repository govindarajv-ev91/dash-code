import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adminServiceError } from '../src/lib/adminServiceError.js'

test('a missing function has a deployment-specific error', async () => {
  const error = await adminServiceError({ name: 'FunctionsHttpError',
    context: Response.json({ code: 'NOT_FOUND', message: 'Requested function does not exist' }, { status: 404 }) })
  assert.equal(error.code, 'ADMIN_SERVICE_NOT_DEPLOYED')
  assert.match(error.message, /must deploy the dashboard-admin service/)
})
test('gateway session failure does not claim the function is missing', async () => {
  const error = await adminServiceError({ name: 'FunctionsHttpError',
    context: Response.json({ message: 'Invalid JWT' }, { status: 401 }) })
  assert.match(error.message, /Sign out and sign in again/)
  assert.doesNotMatch(error.message, /not installed/)
})
test('useful validation and role errors from the verified handler reach the admin', async () => {
  for (const [status, message] of [[403, 'Administrator access is required.'], [409, 'An account with this email already exists.']]) {
    const error = await adminServiceError({ name: 'FunctionsHttpError', context: Response.json({ error: message }, { status }) })
    assert.equal(error.message, message)
  }
})
test('a boot failure with non-JSON response shows a server setup problem', async () => {
  const error = await adminServiceError({ name: 'FunctionsHttpError', context: new Response('Bad gateway', { status: 503 }) })
  assert.match(error.message, /could not start/)
})
test('transport errors show a connection problem without exposing internal details', async () => {
  const error = await adminServiceError({ name: 'FunctionsFetchError', message: 'sensitive diagnostic' })
  assert.match(error.message, /Cannot reach user management/)
  assert.doesNotMatch(error.message, /sensitive diagnostic|not installed/)
})
