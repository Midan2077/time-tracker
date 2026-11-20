import type { PlatformApi } from '../platform/api'

declare global {
  interface Window {
    // Мост из electron preload (contextBridge). Отсутствует в browser-режиме.
    tzPlatform?: PlatformApi
  }
}

export {}
