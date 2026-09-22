import { execSync } from 'node:child_process'
import { createLogger, defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const viteLogger = createLogger()

// Backends are published on IPv4 loopback only (docker-compose binds 127.0.0.1).
// Using localhost here lets Node pick ::1, after which the proxy gets ECONNREFUSED.
// dexmonitor is exposed on 127.0.0.1:5002 for local dev (docker-compose ports).
// Proxying /api directly bypasses nginx basic-auth, which the Vite proxy cannot
// satisfy without embedding plaintext credentials in this file.
// Grafana is not exposed to the host separately, so it still goes through the
// nginx TLS edge on 5443 (Grafana manages its own auth — no htpasswd there).
const DEV_DEXMONITOR = 'http://127.0.0.1:5002'
const DEV_UNIFIED_API = 'http://127.0.0.1:5010'
const DEV_TLS_EDGE = 'https://127.0.0.1:5443'

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

function quietWsProxy(target: string, secure?: boolean): ProxyOptions {
  return {
    target,
    ws: true,
    changeOrigin: true,
    ...(secure !== undefined ? { secure } : {}),
    configure: (proxy) => {
      // Dev backends can drop websocket upgrades during restarts; avoid noisy duplicate logs.
      proxy.on('error', () => {})
    },
  }
}

function httpsEdgeProxy(): ProxyOptions {
  return {
    target: DEV_TLS_EDGE,
    secure: false,
    changeOrigin: true,
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
  resolve: {
    // Vite 8's optimizer can emit two React instances across lazy chunks
    // (Invalid hook call / useRef of null in OHLCChart). Pin a singleton.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ],
  },
  server: {
    // Default `localhost` binds ::1 only on this host, so ws://127.0.0.1:5173
    // (Chrome's usual localhost WebSocket family) is refused and HMR dies.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      clientPort: 5173,
      path: '/__vite_hmr',
    },
    proxy: {
      // The unified API compares the WebSocket Origin with Host. Preserve the
      // browser-facing localhost:5173 host so legitimate dev connections pass.
      '/ws/live_offers':        { ...quietWsProxy('ws://127.0.0.1:5010'), changeOrigin: false },
      '/api/live_offers':       DEV_UNIFIED_API,
      '/api/execution-quotes':  DEV_UNIFIED_API,
      '/api/trade_cost_config': DEV_UNIFIED_API,
      '/api/cex_permissions': DEV_UNIFIED_API,
      '/api':                   DEV_DEXMONITOR,
      '/ws/cex':                quietWsProxy('ws://127.0.0.1:5002'),
      // Grafana isn't exposed to the host in local dev; reach it through nginx
      // (TLS edge on 5443), which proxies the /grafana/ sub-path to the grafana
      // container. Without these the dev server's SPA fallback serves
      // index.html for /grafana/ — the Metrics link just reopens the frontend.
      // The /grafana/api/live websocket must precede /grafana to match first.
      '/grafana/api/live':      quietWsProxy('wss://127.0.0.1:5443', false),
      '/grafana':               httpsEdgeProxy(),
    },
  },
})
