// Deno supplies connection info as the second callback argument. The shared
// handler reserves that argument for a Node response, so pass only the request.
export function asDenoHandler(handler) {
  return (request) => handler(request)
}
