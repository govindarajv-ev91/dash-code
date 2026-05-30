import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function riderPerformanceApiPlugin() {
  return {
    name: 'rider-performance-api',
    configureServer(server) {
      server.middlewares.use('/api/rider-performance-csv', async (req, res, next) => {
        if (req.method !== 'GET') return next()

        const env = loadEnv(server.config.mode, process.cwd(), '')
        process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
        process.env.VITE_SUPABASE_ANON_KEY =
          env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

        const url = new URL(req.url || '/', 'http://localhost')
        const query = Object.fromEntries(url.searchParams.entries())

        const mockRes = {
          statusCode: 200,
          headers: {},
          setHeader(name, value) {
            this.headers[name.toLowerCase()] = value
          },
          status(code) {
            this.statusCode = code
            return this
          },
          json(body) {
            this.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.statusCode = this.statusCode
            Object.entries(this.headers).forEach(([k, v]) => res.setHeader(k, v))
            res.end(JSON.stringify(body))
          },
          send(body) {
            res.statusCode = this.statusCode
            Object.entries(this.headers).forEach(([k, v]) => res.setHeader(k, v))
            res.end(body)
          },
        }

        try {
          const { default: handler } = await import('./api/rider-performance-csv.js')
          await handler({ method: 'GET', query }, mockRes)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err?.message || 'API error' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), riderPerformanceApiPlugin()],
  server: {
    proxy: {
      '/api/fleet-sheet-csv': {
        target: 'https://docs.google.com',
        changeOrigin: true,
        secure: true,
        rewrite: () =>
          '/spreadsheets/d/e/2PACX-1vQcqousIenx7wOzlCIB6rw0zSXnfiwmWyXPcTzYoDX5E9PryySAoMLMjiWNdlVg8vYWUIX3iqM4VG0D/pub?gid=721267187&single=true&output=csv',
      },
      '/api/sheet-csv': {
        target: 'https://docs.google.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          const queryStart = path.indexOf('?')
          if (queryStart === -1) return path
          const params = new URLSearchParams(path.slice(queryStart + 1))
          const sheetUrl = params.get('url')
          if (!sheetUrl) return path
          try {
            const parsed = new URL(sheetUrl)
            if (parsed.hostname !== 'docs.google.com') return path
            return parsed.pathname + parsed.search
          } catch {
            return path
          }
        },
      },
    },
  },
})
