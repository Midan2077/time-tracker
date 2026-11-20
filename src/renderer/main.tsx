import { createRoot } from 'react-dom/client'
import type { PlatformApi } from '../platform/api'
import { createBrowserPlatform } from '../platform/browser'
import { App } from './App'

// Выбор реализации платформы: Electron-мост из preload либо browser-адаптер.
// Сам renderer про Electron ничего не знает (ТЗ §5).
const platform: PlatformApi = window.tzPlatform ?? createBrowserPlatform()

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')
createRoot(container).render(<App platform={platform} />)
