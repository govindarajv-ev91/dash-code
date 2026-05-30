import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
