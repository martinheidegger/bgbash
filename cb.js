'use strict'
const { ChildProcess } = require('child_process')
const { sep, resolve } = require('path')
const { createLockCb } = require('flexlock-cb')
const { readFile } = require('fs')
const once = require('once')
const assert = require('assert')

const EMPTY = Buffer.from('')

function appendBuffer (a, b) {
  if (a === undefined) {
    return b
  }
  if (Array.isArray(a)) {
    a.push(b)
    return a
  }
  return [a, b]
}

function track (proc, errPath, timeout, cb) {
  let out
  const onout = chunk => {
    out = appendBuffer(out, chunk)
  }
  let code = null
  const onerr = chunk => {
    code = parseInt(chunk.toString(), 16)
    if (code === 0) {
      // In case we get a 0 error code we don't
      // parse or pass the stderr, because it costs
      // a lot of time & cpu
      return end(null, EMPTY)
    }
    readFile(errPath, (err, stderr) => {
      if (err) {
        err = Object.assign(new Error('Cannot read stderr'), {
          code: 'ENOERRFILE',
          exitCode: code,
          cause: err
        })
        return end(err, EMPTY)
      }
      end(null, stderr)
    })
  }
  const onexit = () => end(Object.assign(new Error('unexpected exit'), { code: 'EDIED' }), EMPTY)

  assert.strictEqual(typeof timeout, 'number', 'timeout needs to be a number')

  let closeTimeout
  if (timeout < 0) {
    assert.fail('timeout needs to be positive')
  }
  if (timeout > 0) {
    closeTimeout = setTimeout(() => {
      end(Object.assign(new Error('Timeout'), { code: 'ETIMEOUT' }), EMPTY)
      proc.kill()
    }, timeout)
  }

  proc.on('exit', onexit)
  proc.stdout.on('data', onout)
  proc.stderr.on('data', onerr)

  const end = once((error, stderr) => {
    proc.removeListener('exit', onexit)
    proc.stdout.removeListener('data', onout)
    proc.stderr.removeListener('data', onerr)
    if (closeTimeout !== undefined) {
      clearTimeout(closeTimeout)
    }
    cb(error, {
      code,
      stdout: Array.isArray(out) ? Buffer.concat(out) : (out || EMPTY),
      stderr
    })
  })
}

function collectErrOut (proc, cb) {
  let out = ''
  proc.stdout.on('data', ondata)

  function ondata (chunk) {
    out += chunk.toString()
    const line = out.indexOf('\n')
    if (line >= 0) {
      proc.stdout.removeListener('data', ondata)
      cb(null, out.substr(0, line))
    }
  }
}

/**
 * This is a copy of Node.js's internal way to created the envPairs,
 * extracting this makes the system yet another little bit quicker.
 */
function createEnvPairs (env) {
  if (!env) env = process.env
  const envPairs = []
  for (const key in env) {
    const value = env[key]
    if (value === undefined) {
      continue
    }
    envPairs.push(`${key}=${value}`)
  }
  if (process.env.NODE_V8_COVERAGE !== undefined && env.NODE_V8_COVERAGE !== undefined) {
    envPairs.push(`NODE_V8_COVERAGE=${env.NODE_V8_COVERAGE}`)
  }
  return envPairs.sort()
}

class BashProcess extends ChildProcess {
  constructor (envPairs, destruct) {
    super()
    this.spawn({
      file: `${__dirname}${sep}index.sh`,
      args: [],
      shell: 'bash',
      envPairs
    })
    this._destruct = once(() => {
      this.destructed = true
      destruct()
    })
    this.on('close', this._destruct)
    this.lock = createLockCb()
    this._toggleTracker(false)
    this.lock(unlock => collectErrOut(this, (err, errPath) => {
      if (err) {
        this._destruct()
        return unlock(err)
      }
      this.errPath = errPath
      unlock()
    }), () => {})
  }
  exec (cmd, encoding, timeout, cb) {
    return this.lock(unlock => {
      this._setCurrent(unlock, encoding, timeout)
      this.stdin.write(`${cmd}\n`)
    }, cb)
  }
  close (cb) {
    return this.lock(unlock => {
      if (this.destructed) {
        return unlock()
      }
      this._destruct()
      this.on('close', unlock)
      this.kill()
    }, cb)
  }
  _setCurrent (unlock, encoding, timeout) {
    this._toggleTracker(false)
    track(this, this.errPath, timeout, (err, result) => {
      if (err) {
        this._destruct()
        return unlock(err, null, null)
      }
      this._toggleTracker(true)
      if (result.code !== 0) {
        err = new Error(`Exit code: ${result.code}`)
        err.code = result.code
      }
      if (encoding === undefined) {
        encoding = 'utf8'
      } else if (!Buffer.isEncoding(encoding)) {
        return unlock(err, result)
      }
      result.stdout = result.stdout.toString(encoding)
      result.stderr = result.stderr.toString(encoding)
      unlock(err, result)
    })
  }
  _toggleTracker (active) {
    if (active !== this._active) {
      this._active = active
      if (active) {
        this.on('close', this._destruct)
      } else {
        this.removeListener('close', this._destruct)
      }
    }
  }
}

function noop () {}

function _exec (cmd, cwd, envPairs, encoding, timeout, cb) {
  cb = cb || noop
  assert.strictEqual(typeof cb, 'function', 'callback is of the wrong type')
  const hash = JSON.stringify(envPairs)
  let proc = procByEnv[hash]
  if (proc === undefined) {
    proc = new BashProcess(envPairs, () => delete procByEnv[hash])
    procByEnv[hash] = proc
  }
  if (cwd) {
    cmd = `cd ${resolve(cwd)}; ${cmd}`
  }
  proc.exec(cmd, encoding, timeout, (err, res) => cb(err, res && res.stdout, res && res.stderr))
}

let procByEnv = {}

function exec (cmd, opts, cb) {
  let envPairs = opts && opts.envPairs
  if (!envPairs) {
    envPairs = createEnvPairs((opts && opts.env) || process.env)
  }
  if (typeof opts === 'function') {
    return _exec(cmd, null, envPairs, undefined, 0, opts)
  }
  if (opts === null || opts === undefined) {
    return _exec(cmd, null, envPairs, undefined, 0, cb)
  }
  return _exec(cmd, opts.cwd, envPairs, opts.encoding, opts.timeout || 0, cb)
}

function close (cb) {
  assert.strictEqual(typeof cb, 'function', 'callback is missing')
  const procs = Object.values(procByEnv)
  procByEnv = {}
  function next () {
    if (procs.length === 0) return cb()
    procs.shift().close(next)
  }
  setImmediate(next)
}

function pid (env) {
  const envPairs = createEnvPairs(env)
  const proc = procByEnv[JSON.stringify(envPairs)]
  if (proc === undefined) {
    return null
  }
  return proc.pid
}

module.exports = {
  exec, close, pid
}
