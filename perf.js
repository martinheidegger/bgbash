#!/usr/bin/env node --expose-gc
'use strict'
if (typeof global.gc !== 'function') {
  console.error('Run again as bash script')
  process.exit(1)
}
const { exec: execBgAsync, close: closeAsync } = require('./promises.js')
const { promisify } = require('util')
const execAsync = promisify(require('child_process').exec)

function start () {
  const start = process.hrtime()
  const cpu = process.cpuUsage()
  return () => {
    const diff = process.hrtime(start)
    const cpuMiS = process.cpuUsage(cpu)
    return {
      time: diff[0] * 1e3 + diff[1] * 1e-6,
      cpu: {
        user: cpuMiS.user / 1000,
        system: cpuMiS.system / 1000
      }
    }
  }
}

function devideInfo (info, devider) {
  return {
    time: info.time / devider,
    cpu: {
      user: info.cpu.user / devider,
      system: info.cpu.system / devider
    }
  }
}

function minMax (tracker, value) {
  if (tracker.min > value) tracker.min = value
  if (tracker.max < value) tracker.max = value
  tracker.avg += value
}

function avg (tracker, count) {
  tracker.avg = tracker.avg / count
  tracker.diff = tracker.max - tracker.min
}

function createMemTracker () {
  const start = process.memoryUsage()
  const stats = {
    rss: { avg: 0, min: Number.MAX_VALUE, max: -Number.MAX_VALUE },
    heapTotal: { avg: 0, min: Number.MAX_VALUE, max: -Number.MAX_VALUE },
    heapUsed: { avg: 0, min: Number.MAX_VALUE, max: -Number.MAX_VALUE },
    external: { avg: 0, min: Number.MAX_VALUE, max: -Number.MAX_VALUE }
  }
  let count = 0
  return {
    track () {
      const usage = process.memoryUsage()
      minMax(stats.rss, usage.rss - start.rss)
      minMax(stats.heapTotal, usage.heapTotal - start.heapTotal)
      minMax(stats.heapUsed, usage.heapUsed - start.heapUsed)
      minMax(stats.external, usage.external - start.external)
      count += 1
    },
    stats () {
      avg(stats.rss, count)
      avg(stats.heapTotal, count)
      avg(stats.heapUsed, count)
      avg(stats.external, count)
      return stats
    }
  }
}

async function clear () {
  global.gc()
  await sleep(100) 
}

async function runOne (count, name, once, cleanup) {
  await clear()
  const mem = createMemTracker()
  mem.track()
  let end = start()
  await once()
  mem.track()
  const first = end()
  end = start()
  for (let i = 0; i < count; i++) {
    await once()
    mem.track()
    global.gc()
  }
  const repeat = devideInfo(end(), count)
  mem.track()
  if (cleanup) await cleanup()
  global.gc()
  await sleep(100)
  mem.track()
  return {
    name,
    mem: mem.stats(),
    first,
    repeat
  }
}

function sleep (time) {
  return new Promise(resolve => setTimeout(resolve, time))
}

function renderMs (time) {
  return `${Math.round(time * 10) / 10}ms`
}

function renderMsDiff (a, b) {
  let perc = 100 - Math.round(100 / a * b)
  let verb = 'faster'
  if (perc < 0) {
    perc *= -1
    verb = 'slower'
  }
  return `${perc}% ${verb}`
}

const KILO = 1024
const MEGA = 1024 * 1024

function renderBytes (bytes) {
  if (bytes > MEGA) {
    return `${Math.round(bytes / MEGA * 10) / 10}Mb`
  }
  if (bytes > KILO) {
    return `${Math.round(bytes / KILO * 10) / 10}Kb`
  }
  return `${Math.round(bytes)}b`
}

function renderMemEntry (entry) {
  const diffMax = Math.abs(entry.max - entry.avg)
  const diffMin = Math.abs(entry.avg - entry.min)
  return `${renderBytes(entry.max)}`
}

async function run (cmd, count) {
  await runOne(count, 'bgback', () => execBgAsync(cmd), closeAsync)
  await runOne(count, 'node.js', () => execAsync(cmd))

  const a = await runOne(count, 'node.js', () => execAsync(cmd))
  const b = await runOne(count, 'bgback', () => execBgAsync(cmd), closeAsync)
  const entries = [a, b]

  return `
| "${cmd}" - ${count} runs |${row(entry => ` ${entry.name} `)}|   |
|---------------|${row(entry => `-${new Array(entry.name.length).join('-')}--`)}|---|
| startup       |${renderTime(entry => entry.first.time)}|
| repeat call   |${renderTime(entry => entry.repeat.time)}|
| cpu.user      |${renderTime(entry => entry.repeat.cpu.user)}|
| cpu.system    |${renderTime(entry => entry.repeat.cpu.system)}|
| mem.rss       |${renderMem(entry => entry.mem.rss)}|
| mem.heapTotal |${renderMem(entry => entry.mem.heapTotal)}|
| mem.heapUsed  |${renderMem(entry => entry.mem.heapUsed)}|
| mem.external  |${renderMem(entry => entry.mem.external)}|
`

  function renderTime (fn) {
    const a1 = fn(a)
    const b1 = fn(b)
    return ` ${renderMs(a1)} | ${renderMs(b1)} | ${renderMsDiff(a1, b1)} `
  }

  function renderMem (fn) {
    const a1 = fn(a)
    const b1 = fn(b)
    return ` ${renderMemEntry(a1)} | ${renderMemEntry(b1)} | `
  }

  function row (fn) {
    return entries.map(fn).join('|')
  }
}

run('echo hi', 500)
  .then((data) => {
    console.log(data)
  }, err => {
    console.log((err && err.stack) || err)
    process.exit(1)
  })
