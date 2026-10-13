export async function adminServiceError(error) {
  const status = error.context?.status
  let payload
  try { payload = await error.context?.json() } catch { /* Response may not be JSON. */ }

  let code = 'ADMIN_SERVICE_ERROR'
  let message = 'User management could not complete the request. Please try again.'
  if (status === 404) {
    code = 'ADMIN_SERVICE_NOT_DEPLOYED'
    message = 'User management is not installed in this Supabase project. The project owner must deploy the dashboard-admin service.'
  } else if (typeof payload?.error === 'string') {
    message = payload.error
  } else if (status === 401) {
    message = 'Your admin session was rejected. Sign out and sign in again. If this continues, ask the project owner to check the admin service authentication.'
  } else if (status === 403) {
    message = 'Administrator access is required to manage users.'
  } else if (status === 429) {
    message = 'Too many requests. Wait a moment and try again.'
  } else if (status === 503) {
    message = 'The user management service could not start. Ask the project owner to check its deployment and server configuration.'
  } else if (status === 502 || status === 504 || error.name === 'FunctionsRelayError') {
    message = 'User management is temporarily unavailable. Please try again.'
  } else if (error.name === 'FunctionsFetchError' || error instanceof TypeError) {
    message = 'Cannot reach user management. Check your connection. If this continues, ask the project owner to verify the service deployment and browser access.'
  }
  const failure = new Error(message)
  failure.code = code
  failure.status = status
  return failure
}
