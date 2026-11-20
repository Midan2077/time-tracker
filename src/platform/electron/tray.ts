// Трей (ТЗ §4 M3): только десктопный слой платформы, UI про него не знает.
// Иконка — локальный base64 PNG 16x16 (сгенерирован при разработке, сеть не тянем,
// ТЗ §4: «при отсутствии иконки — простая заглушка»).
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'

const TRAY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAI0lEQVR42mNgoAaITimqIAejG/CfRDxqwKgBw9UA8jMTJQAAzdCRZC65tucAAAAASUVORK5CYII='

export type TrayController = {
  setTimerActive(active: boolean): void
  destroy(): void
}

export function createTray(win: BrowserWindow): TrayController {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64'))
  let timerActive = false
  let isQuitting = false

  const tray = new Tray(icon)
  tray.setToolTip('Тайм-трекер')
  const rebuild = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Открыть',
          click: () => {
            win.show()
            win.focus()
          },
        },
        {
          // Владелец таймера — UI (store пишет БД); трей только шлёт команду и отражает состояние.
          label: timerActive ? 'Стоп таймера' : 'Старт таймера',
          click: () => win.webContents.send('timer:command', 'toggle'),
        },
        { type: 'separator' },
        {
          label: 'Выход',
          click: () => {
            isQuitting = true
            app.quit()
          },
        },
      ]),
    )
  }
  rebuild()

  // Крестик = в трей, не выход (ТЗ §4 M3). «Выход» из меню ставит флаг и гасит приложение.
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  return {
    setTimerActive(active) {
      if (active !== timerActive) {
        timerActive = active
        rebuild()
      }
    },
    destroy() {
      isQuitting = true
      tray.destroy()
    },
  }
}
