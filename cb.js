'use strict'
const { ChildProcess } = require('child_process')
const { sep, resolve } = require('path')
const { createLockCb } = require('flexlock-cb')
const { readFile, createWriteStream } = require('fs')
const isNodeIssue18446 = process.platform !== 'darwin' // https://github.com/nodejs/node/issues/18446
const once = require('once')
const assert = require('assert')
const args = [
  // We could take process.env.SHELL instead, but the ./index.sh has not been tested with all possible other shells.
  // We can also not use /bin/sh as the "eval" command used would then fallback to sh semantics
  '/bin/bash',
  '--noprofile', // No bash_profile or other startup should be loaded, skewing the output.
  `${__dirname}${sep}index${isNodeIssue18446 ? '_node_issue_18446' : ''}.sh`
]
const stdio = isNodeIssue18446 ? ['ignore', 'pipe', 'pipe'] : 'pipe'

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

function collectIOPath (proc, cb) {
  let out = ''
  proc.stdout.on('data', ondata)
  proc.stderr.on('data', onerr)

  function finish (err, result) {
    proc.stdout.removeListener('data', ondata)
    proc.stderr.removeListener('data', onerr)
    cb(err, result)
  }

  function ondata (chunk) {
    out += chunk.toString()
    const lines = out.split('\n')
    if (isNodeIssue18446) {
      if (lines.length > 2) {
        finish(null, { errPath: lines[0], inPath: lines[1] })
      }
    } else {
      if (lines.length > 1) {
        finish(null, { errPath: lines[0] })
      }
    }
  }

  function onerr (chunk) {
    finish(new Error('Unexpected error output: ' + chunk.toString()))
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
      file: 'bash',
      args,
      envPairs,
      stdio
    })
    this._destruct = once((err) => {
      this.destructed = err || new Error('Closed.')
      destruct()
    })
    this.on('close', this._destruct)
    this.lock = createLockCb()
    this._toggleTracker(false)
    this.lock(unlock => collectIOPath(this, (err, paths) => {
      if (err) {
        this._destruct(Object.assign(new Error(`Couldn't receive error file`), {
          code: err.code,
          cause: err
        }))
        return unlock(err)
      }
      const { errPath, inPath } = paths
      this._stdin = inPath === undefined ? this.stdin : createWriteStream(inPath, { flags: 'a' })
      this._stdin.on('error', this._destruct)
      this.errPath = errPath
      unlock()
    }), () => {})
  }
  exec (cmd, encoding, timeout, cb) {
    return this.lock(unlock => {
      if (this.destructed) {
        return unlock(this.destructed)
      }
      this._setCurrent(unlock, encoding, timeout)
      this._stdin.write(`${cmd};\n`)
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
        this._destruct(err)
        return unlock(err, null, null)
      }
      this._toggleTracker(true)
      if (result.code !== 0) {
        err = new Error(`Exit code: ${result.code}:\n${result.stderr}`)
        err.code = result.code
        err.stderr = result.stderr
        err.stdout = result.stdout
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
let warnOnce = true

function exec (cmd, opts, cb) {
  if (process.platform === 'win32') {
    return setImmediate(cb, new Error('Windows platform is not supported. Pull Requests warmly welcome.'))
  }
  if (warnOnce && !(process.platform === 'darwin' || process.platform === 'linux')) {
    if (warnOnce) {
      console.warn(`WARNING: bgback has not been tested on the ${process.platform} platform.`)
      warnOnce = false
    }
  }
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
