#!/usr/bin/env node --expose-gc
'use strict'
if (typeof global.gc !== 'function') {
  console.error('Run again as bash script')
  process.exit(1)
}
const cluster = require('cluster')

function minMax (tracker, value) {
  if (tracker.min > value) tracker.min = value
  if (tracker.max < value) tracker.max = value
  tracker.avg += value
}

function finalMemory (tracker, count, start, end) {
  tracker.avg = tracker.avg / count
  tracker.diff = tracker.max - tracker.min
  tracker.final = end - start
}

function initMemoryValue () {
  return { min: Number.MAX_VALUE, max: -Number.MAX_VALUE, avg: 0, final: 0, diff: 0 }
}

function createMemTracker () {
  const stats = {
    rss: initMemoryValue(),
    heapTotal: initMemoryValue(),
    heapUsed: initMemoryValue(),
    external: initMemoryValue()
  }
  const start = process.memoryUsage()
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
    final () {
      const end = process.memoryUsage()
      finalMemory(stats.rss, count, start.rss, end.rss)
      finalMemory(stats.heapTotal, count, start.heapTotal, end.heapTotal)
      finalMemory(stats.heapUsed, count, start.heapUsed, end.heapUsed)
      finalMemory(stats.external, count, start.external, end.external)
      return stats
    }
  }
}

function createCpuTracker () {
  const first = {
    time: 0,
    cpu: {
      user: 0,
      system: 0
    }
  }
  const repeat = {
    time: 0,
    cpu: {
      user: 0,
      system: 0
    }
  }
  let start = null
  let cpu = null

  function reset () {
    start = process.hrtime()
    cpu = process.cpuUsage()
  }

  function store (entry) {
    const diff = process.hrtime(start)
    const cpuMiS = process.cpuUsage(cpu)
    entry.time = diff[0] * 1e3 + diff[1] * 1e-6
    entry.cpu.user = cpuMiS.user / 1000
    entry.cpu.system = cpuMiS.system / 1000
  }

  return {
    first,
    repeat,
    beforeFirst: reset,
    beforeRepeat () {
      store(first)
      reset()
    },
    end (count) {
      store(repeat)
      repeat.time = repeat.time / count
      repeat.cpu.user = repeat.cpu.user / count
      repeat.cpu.system = repeat.cpu.system / count
    }
  }
}

async function cleanSlate () {
  global.gc()
  await sleep(100)
}

async function runOne (count, name, once, cleanup) {
  // Memory for the test should be allocated in this block
  const cpu = createCpuTracker()
  const mem = createMemTracker()
  let i = 0
  // No more variable declarations
  await cleanSlate()
  cpu.beforeFirst()
  await once()
  mem.track()
  cpu.beforeRepeat()
  for (; i < count; i++) {
    await once()
    mem.track()
  }
  cpu.end(count)
  if (cleanup) {
    await cleanup()
  }
  await cleanSlate()
  return {
    name,
    mem: mem.final(),
    first: cpu.first,
    repeat: cpu.repeat
  }
}

function sleep (time) {
  return new Promise(resolve => setTimeout(resolve, time))
}

function renderMs (time) {
  return `${Math.round(time * 100) / 100}ms`
}

function renderMsDiff (a, b) {
  let perc
  let verb
  if (a < b) {
    verb = 'slower'
    perc = Math.round(100 / a * b) - 100
  } else {
    verb = 'faster'
    perc = Math.round(100 / b * a)
  }
  return `${perc}% ${verb}`
}

const KILO = 1024
const MEGA = 1024 * 1024

function renderBytes (bytes) {
  const prefix = bytes < 0 ? '-' : ''
  bytes = Math.abs(bytes)
  if (bytes > MEGA) {
    return `${prefix}${Math.round(bytes / MEGA * 10) / 10}Mb`
  }
  if (bytes > KILO) {
    return `${prefix}${Math.round(bytes / KILO * 10) / 10}Kb`
  }
  return `${prefix}${Math.round(bytes)}b`
}

function renderMemEntry (entry) {
  return `${renderBytes(entry.max)} (avg. ${renderBytes(entry.avg)})`
}

const ops = [
  cmd => {
    const { promisify } = require('util')
    const execAsync = promisify(require('child_process').exec)
    return {
      name: 'node.js',
      op: () => execAsync(cmd)
    }
  },
  cmd => {
    const { exec: execBgAsync, close: closeAsync } = require('./promises.js')
    return {
      name: 'bgback',
      op: () => execBgAsync(cmd),
      end: closeAsync
    }
  }
]

function runOneInClusterByIndex (id) {
  return new Promise((resolve, reject) => {
    const fork = cluster.fork({ PERF_ID: id })
    fork.on('exit', reject)
    fork.on('message', resolve)
  })
}

async function run (cmd, count) {
  const entries = []
  if (cluster.isMaster) {
    for (let i = 0; i < ops.length; i++) {
      entries[i] = await runOneInClusterByIndex(i)
    }

    return `
| "${cmd}" - ${count} runs on node-${process.version}(${process.platform}) |${row(entry => ` ${entry.name} `)}| notes |
|-----------------|${row(entry => `-${new Array(entry.name.length).join('-')}--`)}|---|
| startup         |${renderTime(entry => entry.first.time)}- The startup is naturally slower as it does a little more. |
| repeat response |${renderTime(entry => entry.repeat.time)}- But repeat calls are significantly faster, |
| repeat user     |${renderTime(entry => entry.repeat.cpu.user)}- with part of it coming from the reduced user execution time ... |
| repeat system   |${renderTime(entry => entry.repeat.cpu.system)}- ... and a significantly reduced system execution time. |
| rss             |${renderMem(entry => entry.mem.rss)} With a significantly lower rss memory allocation (which is stable even with more calls)  |
| heap total      |${renderMem(entry => entry.mem.heapTotal)} The node.js version also fills up the heap a lot quicker to a avg. 32Mb use at 10000 execs while the bgback version needs around 20000 to get there. |
| heap used       |${renderMem(entry => entry.mem.heapUsed)} The difference in size can be attributed to the additional code loaded.  This will slightly grow with number of calls (~20kb per 5000 calls). Reason is unclear but consistent for both the node.js and bgback version. |
| c-memory inc.   |${renderMem(entry => entry.mem.external)} The C++ memory can be negative as some initial c memory is cleared. |
    `
  } else {
    const op = ops[parseInt(process.env.PERF_ID, 10)](cmd)
    const data = await runOne(count, op.name, op.op, op.end)
    await new Promise(resolve => process.send(data, resolve))
    process.exit()
  }

  function renderTime (fn) {
    const a1 = fn(entries[0])
    const b1 = fn(entries[1])
    return ` ${renderMs(a1)} | ${renderMs(b1)} | ${renderMsDiff(a1, b1)} `
  }

  function renderMem (fn) {
    const a1 = fn(entries[0])
    const b1 = fn(entries[1])
    return ` ${renderMemEntry(a1)} | ${renderMemEntry(b1)} |`
  }

  function row (fn) {
    return entries.map(fn).join('|')
  }
}

run('echo hi', 2000)
// run('cat package-lock.json', 1000)
// run('networksetup -listnetworkserviceorder', 1000)
  .then((data) => {
    console.log(data)
  }, err => {
    console.log((err && err.stack) || err)
    process.exit(1)
  })
