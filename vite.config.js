import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function createMockRes(res) {
  return {
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
}

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
        const mockRes = createMockRes(res)

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

function ev91MisApiPlugin() {
  return {
    name: 'ev91-mis-api',
    configureServer(server) {
      const mount = (middlewares) => {
        middlewares.use('/api/ev91-mis', async (req, res, next) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type')
            res.end()
            return
          }
          if (req.method !== 'GET') return next()

          const env = loadEnv(server.config.mode, process.cwd(), '')
          process.env.EV91_MIS_API_KEY =
            env.EV91_MIS_API_KEY || env.VITE_EV91_MIS_API_KEY || process.env.EV91_MIS_API_KEY
          process.env.VITE_EV91_MIS_API_KEY =
            env.VITE_EV91_MIS_API_KEY || process.env.VITE_EV91_MIS_API_KEY

          const url = new URL(req.url || '/', 'http://localhost')
          const query = Object.fromEntries(url.searchParams.entries())
          const mockRes = createMockRes(res)

          try {
            const { default: handler } = await import('./api/ev91-mis.js')
            await handler({ method: 'GET', query, url: req.url }, mockRes)
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ success: false, message: err?.message || 'API error' }))
          }
        })
      }
      mount(server.middlewares)
    },
    configurePreviewServer(server) {
      // Same proxy for `vite preview` / local prod builds
      const env = loadEnv(server.config.mode, process.cwd(), '')
      process.env.EV91_MIS_API_KEY =
        env.EV91_MIS_API_KEY || env.VITE_EV91_MIS_API_KEY || process.env.EV91_MIS_API_KEY
      server.middlewares.use('/api/ev91-mis', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        const url = new URL(req.url || '/', 'http://localhost')
        const query = Object.fromEntries(url.searchParams.entries())
        const mockRes = createMockRes(res)
        try {
          const { default: handler } = await import('./api/ev91-mis.js')
          await handler({ method: 'GET', query, url: req.url }, mockRes)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: false, message: err?.message || 'API error' }))
        }
      })
    },
  }
}

function rentalPendingApiPlugin() {
  return {
    name: 'rental-pending-api',
    configureServer(server) {
      server.middlewares.use('/api/rental-pending', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, x-api-key')
          res.end()
          return
        }
        if (req.method !== 'GET') return next()

        const env = loadEnv(server.config.mode, process.cwd(), '')
        process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL
        process.env.VITE_SUPABASE_ANON_KEY =
          env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
        process.env.RENTAL_PENDING_API_KEY = (
          env.RENTAL_PENDING_API_KEY ||
          process.env.RENTAL_PENDING_API_KEY ||
          'ev91-rental-pending-2026'
        ).trim()

        // Mount strips path; keep full URL so ?api_key= / ?ev91_rider_id= parse correctly
        const rawUrl = req.originalUrl || req.url || '/'
        const url = new URL(rawUrl, 'http://localhost')
        const query = Object.fromEntries(url.searchParams.entries())
        const headerKey =
          req.headers['x-api-key'] ||
          (typeof req.headers.authorization === 'string' &&
          /^Bearer\s+/i.test(req.headers.authorization)
            ? req.headers.authorization.replace(/^Bearer\s+/i, '')
            : '') ||
          query.api_key ||
          query.apiKey ||
          query.key ||
          ''
        const mockReq = {
          method: 'GET',
          query,
          url: rawUrl,
          originalUrl: rawUrl,
          headers: {
            'x-api-key': String(headerKey).trim(),
          },
        }
        const mockRes = createMockRes(res)

        try {
          const { default: handler } = await import('./api/rental-pending.js')
          await handler(mockReq, mockRes)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              success: false,
              message: err?.message || 'API error',
            })
          )
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), riderPerformanceApiPlugin(), ev91MisApiPlugin(), rentalPendingApiPlugin()],
  server: {
    // Always use 5173. If an old npm run dev is still running, fail instead of
    // silently opening 5174 (different origin = empty cache / "no data").
    port: 5173,
    strictPort: true,
    host: true,
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
