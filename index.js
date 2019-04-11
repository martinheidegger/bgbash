'use strict'
const { spawn } = require('child_process')
const { sep, resolve } = require('path')
const { createLockCb } = require('flexlock-cb')
const objectHash = require('object-hash')

const NUM_LENGTH = 14
const MIN_LENGTH = 2 + NUM_LENGTH * 2

function getPart (buf, offset) {
  if (buf.length < offset + NUM_LENGTH) {
    return
  }
  const lengthEnd = offset + NUM_LENGTH
  const dataLength = parseInt(buf.slice(offset, lengthEnd), 16)
  const end = lengthEnd + dataLength
  if (buf.length < end) {
    return
  }
  return {
    data: buf.slice(lengthEnd, end),
    end
  }
}

function getData (buf) {
  if (buf.length < MIN_LENGTH) {
    return
  }
  const code = parseInt(buf.slice(0, 2), 16)
  const out = getPart(buf, 2)
  if (out === undefined) {
    return
  }
  const err = getPart(buf, out.end)
  if (err === undefined) {
    return
  }
  return {
    code,
    out: out.data,
    err: err.data
  }
}

function track (stream, cb) {
  let out = Buffer.from('')
  let err = Buffer.from('')
  stream.stdout.on('data', ondata)
  stream.stderr.on('data', onerr)
  stream.on('exit', code => {
    cb(null, {
      code,
      out: '',
      err
    })
  })

  function ondata (chunk) {
    out = Buffer.concat([out, chunk])
    const result = getData(out)
    if (result !== undefined) {
      stream.stdout.removeListener('data', ondata)
      stream.stderr.removeListener('data', onerr)
      cb(null, result)
    }
  }

  function onerr (chunk) {
    err = Buffer.concat([err, chunk])
  }
}

function createHash (input) {
  if (input === null) {
    return null
  }
  return objectHash(input)
}

class Process {
  constructor (env) {
    this.proc = spawn(`${__dirname}${sep}index.sh`, { env })
    this._markDead = () => {
      this.dead = true
    }
    this._toggleTracker(false)
    this.lock = createLockCb()
  }
  exec (cmd, cb) {
    return this.lock(unlock => {
      this._setCurrent(unlock)
      this.proc.stdin.write(`${cmd}\n`)
    }, cb)
  }
  close (cb) {
    return this.lock(unlock => {
      if (this.dead) {
        return unlock()
      }
      this.dead = true
      this.proc.on('close', () => {
        unlock()
      })
      this.proc.stdin.write(`SIGTERM\n`)
    }, cb)
  }
  _setCurrent (unlock) {
    this._toggleTracker(false)
    track(this.proc, (err, data) => {
      if (err) {
        this.dead = true
      } else {
        this._toggleTracker(true)
      }
      unlock(err, data)
    })
  }
  _toggleTracker (active) {
    if (active !== this._active) {
      this._active = active
      if (active) {
        this.proc.addListener('close', this._markDead)
      } else {
        this.proc.removeListener('close', this._markDead)
      }
    }
  }
}

let procByEnv = {}

function exec (cmd, cwd, env, cb) {
  const hash = createHash(env)
  let proc = procByEnv[hash]
  if (proc === undefined || proc.dead) {
    proc = new Process(env, () => {
      delete procByEnv[hash]
    })
    procByEnv[hash] = proc
  }
  if (cwd) {
    cmd = `cd ${resolve(cwd)}; ${cmd}`
  }
  return proc.exec(cmd, cb)
}

exports.pid = function (env) {
  const proc = procByEnv[createHash(env || null)]
  if (proc === undefined || proc.dead) {
    return -1
  }
  return proc.proc.pid
}

function close (cb) {
  if (!cb) {
    return new Promise((resolve, reject) => close((err, data) => {
      if (err) return reject(err)
      resolve(data)
    }))
  }
  const procs = Object.values(procByEnv)
  procByEnv = {}
  function next () {
    if (procs.length === 0) return cb()
    procs.shift().close(next)
  }
  setImmediate(next)
}

exports.close = close

exports.exec = function (cmd, opts, cb) {
  if (typeof opts === 'function') {
    return exec(cmd, null, null, opts)
  }
  if (opts === null || opts === undefined) {
    return exec(cmd, null, null, cb)
  }
  return exec(cmd, opts.cwd, opts.env || null, cb)
}
