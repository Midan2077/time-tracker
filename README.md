# Тайм-трекер (coursework-friend)

Кросс-платформенный недельный тайм-трекер: Electron + Vite + React + TypeScript (strict).
Полное ТЗ: `tz-tracker-crossplatform.md`. Решения: `DECISIONS.md`. Известные проблемы: `KNOWN_ISSUES.md`.

## Статус

- [x] M0 — каркас: окно, безопасность, PlatformApi (electron + browser), тесты
- [x] M1 — данные: файл БД, миграции, тесты
- [x] M2 — календарь, проекты
- [x] M2.5 — планирование на будущее
- [ ] M3 — таймер и трей
- [ ] M3.5 — напоминания
- [ ] M4 — отчёты и CSV
- [ ] M5 — CI-сборки и документация

## Запуск (режим разработки)

Требуется Node.js >= 22.

```bash
npm ci
npm run dev          # Electron-приложение
npm run dev:browser  # тот же UI в обычном браузере (http://localhost:5173)
npm test             # тесты shared-слоя (Vitest)
npm run typecheck    # строгая проверка типов (node + web конфигурации)
npm run build        # сборка renderer/main/preload в out/
```

## Где лежат данные

- В разработке: каталог проекта `.data/db.json`.
- В собранном приложении: каталог userData платформы (подробные пути — после M5 в README).
