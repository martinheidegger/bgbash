'use strict'
const { test } = require('tap')
const { sep } = require('path')
const { exec: rawExec, close, pid } = require('./index.js')
const { EOL } = require('os')
const fs = require('fs').promises

function out (out) {
  return {
    code: 0,
    out: `${out}${EOL}`,
    err: ''
  }
}

function err (code, err, out) {
  return {
    code,
    out: out ? `${out}${EOL}` : '',
    err: err ? `${err}${EOL}` : ''
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function exec (cmd, opts) {
  const { code, out, err } = await rawExec(cmd, opts)
  return {
    code,
    out: out.toString(),
    err: err.toString()
  }
}

test('simple command', async t => {
  t.deepEquals(await exec('echo hi'), out('hi'))
})

test('Exit code', async t => {
  t.deepEquals(await exec('bash -c "exit 1"'), err(1, ''))
})

test('Error output', async t => {
  t.deepEquals(await exec('echo hi >&2'), err(0, 'hi'))
})

test('process cwd', async t => {
  t.deepEquals(await exec('pwd'), out(process.cwd()))
})

test('custom cwd', async t => {
  t.deepEquals(await exec('pwd', { cwd: '/' }), out('/'))
})

test('custom env variable', async t => {
  t.deepEquals(await exec('echo $A', { env: { A: 'b' } }), out('b'))
})

test('parallel execution', async t => {
  t.deepEquals(await Promise.all([exec('echo hi'), exec('echo ho')]), [out('hi'), out('ho')])
})

test('pid exists', async t => {
  t.type(pid(), 'number')
  t.notEquals(pid(), '-1')
})

test('pid unknown', async t => {
  t.equals(pid({ x: 1 }), -1)
})

test('cb > exec', async t => {
  t.deepEquals(await new Promise((resolve, reject) => {
    rawExec('echo hi', (err, data) => {
      if (err) return reject(err)
      resolve({
        code: data.code,
        out: data.out.toString(),
        err: data.err.toString()
      })
    })
  }), out('hi'))
})
/*
  test('cb > closing', t => {
    close(() => {
      t.end()
    })
  })
*/

test('killing the process should run', async t => {
  process.kill(pid())
  await sleep(10)
  t.deepEquals(await exec('echo hi'), out('hi'))
})

test('Image buffer', async t => {
  const file = `${__dirname}${sep}test${sep}mutual.png`
  const { out } = await rawExec(`cat "${file}"`)
  const data = await fs.readFile(file)
  t.equals(Buffer.compare(out, data), 0)
})

test('piping', async t => {
  t.deepEquals(await exec('echo hi | cat'), out('hi'))
})

test('escaping', async t => {
  t.deepEquals((await exec(`data=("a" "b" "c");echo "\${#data[@]}"`)), out('3'))
})

test('after', () => {
  return close()
})
