import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ws/live_offers':        { target: 'ws://localhost:5010', ws: true },
      '/api/live_offers':       'http://localhost:5010',
      '/api/trade_cost_config': 'http://localhost:5010',
      '/api':                   'http://localhost:5000',
      '/ws':                    { target: 'ws://localhost:5000', ws: true },
    },
  },
})
