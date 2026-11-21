import { describe, expect, it } from 'vitest'
import { csvRows, csvCell, reportCsv, CSV_BOM, CSV_SEP } from './csv'
import type { Entry, Project } from './db'

const project = (id: string, name: string, archived = false): Project => ({ id, name, color: '#111111', archived })
const entry = (over: Partial<Entry> & { id: string; start: string; end: string }): Entry => ({
  projectId: null,
  title: 'блок',
  ...over,
})

// Фикстура с ручной сверкой (ТЗ §4 M4 «сверь суммы вручную»). now = пт 20.11 12:00 UTC.
// Неделя (для_range) = 15.11 21:00Z .. 22.11 21:00Z (пн 16.11 00:00 .. пн 23.11 00:00 в MSK).
const RANGE = { start: '2026-11-15T21:00:00Z', end: '2026-11-22T21:00:00Z' }
const NOW = '2026-11-20T12:00:00Z'

describe('csvCell/csvRows — форматирование (ТЗ: BOM, ";", CRLF)', () => {
  it('экранирует точку с запятой, кавычки и переводы строк', () => {
    expect(csvCell('раз;два')).toBe('"раз;два"')
    expect(csvCell('а "б" в')).toBe('"а ""б"" в"')
    expect(csvCell('без спецсимволов')).toBe('без спецсимволов')
  })
  it('BOM в начале, CRLF между строками, разделитель — только ";"', () => {
    const text = csvRows([['a', 'b'], ['c', 'd']])
    expect(text.startsWith(CSV_BOM)).toBe(true)
    expect(text).toBe('\uFEFFa;b\r\nc;d\r\n')
    expect(text.slice(1).includes(',')).toBe(false)
  })
})

describe('reportCsv — сводка по фикстуре (ручная сверка)', () => {
  const entries = [
    entry({ id: 'a', projectId: 'p1', title: 'Летний спринт', start: '2026-11-16T06:00:00Z', end: '2026-11-16T07:30:00Z' }), // 90 мин, весь в периоде
    entry({ id: 'b', projectId: 'p1', title: 'Ночной', start: '2026-11-15T20:00:00Z', end: '2026-11-15T22:00:00Z' }), // 120, клиппится к началу: 60
    entry({ id: 'c', title: 'Без проекта', start: '2026-11-18T09:00:00Z', end: '2026-11-18T09:45:00Z' }), // 45
    entry({ id: 'd', projectId: 'p2', title: 'Архивный', start: '2026-11-19T07:00:00Z', end: '2026-11-19T08:00:00Z' }), // 60, архив — в отчёте
    entry({ id: 'e', projectId: 'p1', title: 'План', start: '2026-11-25T06:00:00Z', end: '2026-11-25T07:00:00Z', planned: true }), // будущее — мимо
    entry({ id: 'f', projectId: 'p1', title: 'До недели', start: '2026-11-10T06:00:00Z', end: '2026-11-10T09:00:00Z' }), // вне периода
  ]
  const projects = [project('p1', 'Основной'), project('p2', 'Архив', true)]

  it('разделы «блоки» и «ИТОГО»; суммы: Основной 150, Архив 60, Без проекта 45, ВСЕГО 255', () => {
    const text = reportCsv(entries, projects, RANGE.start, RANGE.end, NOW)
    expect(text.startsWith(CSV_BOM)).toBe(true)
    const lines = text.slice(CSV_BOM.length).split('\r\n')
    expect(lines[0]).toBe('Проект;Дата;Начало;Конец;Минуты;Задача')
    // 4 фактических строки (план и «до недели» — нет); клиппинг «Ночного» 120->60
    const blockLines = lines.filter((l) => /;\d\d:\d\d;\d\d:\d\d;\d+;/.test(l))
    expect(blockLines.length).toBe(4)
    expect(lines.some((l) => l.includes(';60;') && l.includes('Ночной'))).toBe(true)
    // ручная сверка итогов
    expect(lines).toContain('Основной;;;;150;')
    expect(lines).toContain('Архив;;;;60;')
    expect(lines).toContain('Без проекта;;;;45;')
    expect(lines).toContain('ВСЕГО;;;;255;')
    expect(lines.some((l) => l.includes('План'))).toBe(false)
    expect(lines.some((l) => l.includes('До недели'))).toBe(false)
  })

  it('русские символы без изменения кодировки; заголовки не экранируются лишним', () => {
    const text = reportCsv(entries, projects, RANGE.start, RANGE.end, NOW)
    expect(text.includes('Основной')).toBe(true)
    const bytes = new TextEncoder().encode(text) // UTF-8 BOM: EF BB BF
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('дата в строке блока — dd.MM.yyyy локальной зоны', () => {
    const text = reportCsv(entries, projects, RANGE.start, RANGE.end, NOW)
    expect(text).toMatch(/;\d{2}\.\d{2}\.\d{4};/)
  })
})
