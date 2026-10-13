// Local editor types for the Deno APIs used by dashboard-admin.
// Supabase provides these APIs when the Edge Function runs.
declare namespace Deno {
  namespace env {
    function get(name: string): string | undefined
  }

  function serve(handler: (request: Request) => Response | Promise<Response>): unknown
}
