import { execSync } from 'node:child_process'
import { createLogger, defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const viteLogger = createLogger()

function gitInfo(): { hash: string; date: string } {
  // CI bakes these in as build args (the image is built without a .git dir);
  // the git fallback below covers the local dev server.
  const envHash = process.env.COMMIT_HASH?.trim()
  if (envHash) return { hash: envHash, date: process.env.COMMIT_DATE?.trim() ?? '' }
  try {
    const hash = execSync('git log -1 --format=%h', { encoding: 'utf8' }).trim()
    const date = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim()
    return { hash, date }
  } catch {
    return { hash: 'unknown', date: '' }
  }
}
const { hash: COMMIT_HASH, date: COMMIT_DATE } = gitInfo()

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
  define: {
    __COMMIT_HASH__: JSON.stringify(COMMIT_HASH),
    __COMMIT_DATE__: JSON.stringify(COMMIT_DATE),
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/ws/live_offers':        quietWsProxy('ws://localhost:5010'),
      '/api/live_offers':       'http://localhost:5010',
      '/api/trade_cost_config': 'http://localhost:5010',
      '/api':                   'http://localhost:5000',
      '/ws':                    quietWsProxy('ws://localhost:5000'),
      // Grafana isn't exposed to the host in local dev; reach it through nginx
      // (port 5000), which proxies the /grafana/ sub-path to the grafana
      // container. Without these the dev server's SPA fallback serves
      // index.html for /grafana/ — the Metrics link just reopens the frontend.
      // The /grafana/api/live websocket must precede /grafana to match first.
      '/grafana/api/live':      quietWsProxy('ws://localhost:5000'),
      '/grafana':               'http://localhost:5000',
    },
  },
})
