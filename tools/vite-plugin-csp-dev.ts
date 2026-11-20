// В dev Vite/React Fast Refresh инжектит inline-прелюд в index.html,
// который блокирует строгий script-src 'self'. В dev ослабляем только script-src;
// в prod-бандле CSP остаётся строгим (проверяется на out/renderer/index.html).
// См. DECISIONS.md (M0).
import type { Plugin } from 'vite'

const STRICT = `script-src 'self'`
const DEV = `script-src 'self' 'unsafe-inline'`

export function cspDevRelax(): Plugin {
  return {
    name: 'csp-dev-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(STRICT, DEV)
    },
  }
}
