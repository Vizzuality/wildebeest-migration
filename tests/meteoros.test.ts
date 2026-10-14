import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Sitio, chubasco, mensual, meteoros, quemaCerca } from '../src/meteoros.ts'

const year = (step = 0.01) => Array.from({ length: Math.round(12 / step) }, (_, i) => i * step)
const steady = (mm: number) => () => mm
const sitio = (patch: Partial<Sitio> = {}): Sitio => ({ lluvia: steady(0), seco: 0, paso: 0, quema: 0, ...patch })
const share = (values: number[]) => values.filter((v) => v > 0).length / values.length

test('no Chubascos in a dry month', () => {
  assert.ok(year().every((m) => chubasco(m, steady(5)) === 0))
})

test('the long rains come as Chubascos with dry spells between', () => {
  const rain = year().map((m) => chubasco(m, steady(150)))
  assert.ok(share(rain) > 0.3, `raining ${share(rain)}`)
  assert.ok(share(rain) < 0.95, `raining ${share(rain)}`)
  assert.ok(Math.max(...rain) <= 1)
})

test('wetter months bring more Chubascos', () => {
  const at = (mm: number) => share(year().map((m) => chubasco(m, steady(mm))))
  assert.ok(at(60) < at(140))
})

test('the same moment of the year is the same Chubasco', () => {
  for (const m of [0.1, 3.27, 4.9, 11.6]) assert.ok(Math.abs(chubasco(m, steady(120)) - chubasco(m + 12, steady(120))) < 1e-9)
})

test('a Chubasco eases in and out instead of switching on', () => {
  const rain = year(0.001).map((m) => chubasco(m, steady(150)))
  const jumps = rain.slice(1).map((v, i) => Math.abs(v - rain[i]))
  assert.ok(Math.max(...jumps) < 0.05)
})

test('clouds gather before the rains reach the Manada', () => {
  const lluvia = (m: number) => (m >= 3 ? 150 : 0)
  const before = meteoros(2.6, sitio({ lluvia }))
  assert.equal(before.lluvia, 0)
  assert.ok(before.nubes > 0.3)
})

test('no Polvo while it rains', () => {
  const wet = year().map((m) => meteoros(m, sitio({ lluvia: steady(150), seco: 1, paso: 80 })))
  assert.ok(wet.every((w) => w.polvo === 0 || w.lluvia === 0))
  assert.ok(wet.every((w) => w.polvo < 0.1))
})

test('the Manada on the move raises more Polvo than standing still', () => {
  const still = meteoros(8, sitio({ seco: 1, paso: 0 })).polvo
  const moving = meteoros(8, sitio({ seco: 1, paso: 80 })).polvo
  assert.ok(still > 0)
  assert.ok(moving > still)
  assert.equal(meteoros(8, sitio({ seco: 0, paso: 80 })).polvo, 0)
})

test('humo only where something burns', () => {
  assert.equal(meteoros(7, sitio()).humo, 0)
  assert.ok(meteoros(7, sitio({ quema: 0.3 })).humo > 0.9)
})

test('Reverbero only over straw', () => {
  assert.equal(meteoros(9, sitio({ seco: 0.2 })).reverbero, 0)
  assert.ok(meteoros(9, sitio({ seco: 1 })).reverbero > 0.9)
})

test('asking for less motion drops the Reverbero and softens rain and dust', () => {
  const s = sitio({ lluvia: steady(150), seco: 1, paso: 80 })
  const m = year().find((t) => chubasco(t, s.lluvia) > 0.5)!
  const full = meteoros(m, s)
  const calm = meteoros(m, s, true)
  assert.equal(meteoros(9, sitio({ seco: 1 }), true).reverbero, 0)
  assert.ok(calm.lluvia < full.lluvia)
  const dusty = sitio({ seco: 1, paso: 80 })
  assert.ok(meteoros(9, dusty, true).polvo < meteoros(9, dusty).polvo)
})

test('every Meteoro stays within 0–1 through the year', () => {
  const s = sitio({ lluvia: (m) => 100 + 100 * Math.sin(m), seco: 0.7, paso: 40, quema: 0.03 })
  for (const m of year()) for (const v of Object.values(meteoros(m, s))) assert.ok(v >= 0 && v <= 1, `${v} at ${m}`)
})

const grid = { nx: 2, nz: 2, step: 10, minX: 0, minZ: 0 }

test('mensual reads a cell at mid-month and eases to the next month', () => {
  const data = new Array(4 * 12).fill(0)
  for (let c = 0; c < 4; c++) for (let m = 0; m < 12; m++) data[c * 12 + m] = m * 10
  assert.equal(mensual(grid, data, 0, 0, 3.5), 30)
  assert.equal(mensual(grid, data, 0, 0, 4), 35)
  assert.equal(mensual(grid, data, 5, 5, 0.5), 0)
})

test('mensual interpolates between cells', () => {
  const data = new Array(4 * 12).fill(0)
  for (let m = 0; m < 12; m++) data[1 * 12 + m] = 100
  assert.equal(mensual(grid, data, 5, 0, 0.5), 50)
})

test('quemaCerca finds the fire in its month and nowhere else', () => {
  const big = { nx: 21, nz: 21, step: 1, minX: 0, minZ: 0 }
  const quemas = new Array(21 * 21).fill(7)
  assert.ok(quemaCerca(big, quemas, 10, 10, 6.95, 8) > 0.5)
  assert.equal(quemaCerca(big, quemas, 10, 10, 3, 8), 0)
  assert.equal(quemaCerca(big, new Array(21 * 21).fill(0), 10, 10, 6.95, 8), 0)
})

test('a burning season keeps smoking across the turn of the month', () => {
  const big = { nx: 21, nz: 21, step: 1, minX: 0, minZ: 0 }
  const quemas = Array.from({ length: 21 * 21 }, (_, i) => (i % 2 ? 6 : 7))
  for (const m of [6, 6.5, 7]) assert.ok(quemaCerca(big, quemas, 10, 10, m, 8) > 0.2, `at ${m}`)
})

test('the sky clears in the dry season', () => {
  assert.equal(meteoros(7, sitio({ lluvia: steady(30) })).nubes, 0)
})

test('late in the dry season the Mara still shimmers and raises dust', () => {
  // About what the Manada finds over the Mara in September: some rain, the grass half straw.
  const mara = sitio({ lluvia: steady(60), seco: 0.5, paso: 40 })
  const dry = year().filter((m) => chubasco(m, mara.lluvia) === 0).map((m) => meteoros(m, mara))
  assert.ok(dry.every((w) => w.reverbero > 0.3))
  assert.ok(dry.every((w) => w.polvo > 0.1))
})

test('even a weak Chubasco lays the dust and stops the shimmer', () => {
  const mara = sitio({ lluvia: steady(60), seco: 0.5, paso: 40 })
  const wet = year(0.002).map((m) => meteoros(m, mara)).filter((w) => w.lluvia > 0.1)
  assert.ok(wet.length > 0)
  assert.ok(wet.every((w) => w.polvo === 0 && w.reverbero === 0))
})
