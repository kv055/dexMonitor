import { createLogger, defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const viteLogger = createLogger()

function shouldIgnoreWsProxyError(message: string): boolean {
  const isWsProxyNoise = message.includes('ws proxy error:') || message.includes('ws proxy socket error:')
  const isBrokenSocket = message.includes('EPIPE') || message.includes('ECONNRESET')
  return isWsProxyNoise && isBrokenSocket
}

function quietWsProxy(target: string): ProxyOptions {
  return {
    target,
    ws: true,
    configure: (proxy) => {
      // Dev backends can drop websocket upgrades during restarts; avoid noisy duplicate logs.
      proxy.on('error', () => {})
    },
  }
}

export default defineConfig({
  customLogger: {
    ...viteLogger,
    error(message, options) {
      if (shouldIgnoreWsProxyError(String(message))) return
      viteLogger.error(message, options)
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ws/live_offers':        quietWsProxy('ws://localhost:5010'),
      '/api/live_offers':       'http://localhost:5010',
      '/api/trade_cost_config': 'http://localhost:5010',
      '/api':                   'http://localhost:5000',
      '/ws':                    quietWsProxy('ws://localhost:5000'),
    },
  },
})
