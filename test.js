'use strict'
const { test } = require('tap')
const { sep } = require('path')
const { exec: execCb, close: closeCb } = require('./cb.js')
const { exec, close, pid } = require('./promises.js')
const { EOL } = require('os')
const { promisify } = require('util')
const { readFile: readFileCb, stat: statCb, unlink: unlinkCb } = require('fs')

const readFile = promisify(readFileCb)
const unlink = promisify(unlinkCb)
const stat = promisify(statCb)

function out (out, err) {
  return {
    stdout: out ? `${out}${EOL}` : '',
    stderr: err ? `${err}${EOL}` : ''
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('simple command', async t => {
  t.deepEquals(await exec('echo hi'), out('hi'))
})

test('Exit code', async t => {
  try {
    await exec('bash -c "exit 1"')
  } catch (err) {
    t.equals(err.code, 1)
  }
})

test('Error output', async t => {
  let res
  try {
    res = await exec('echo hi >&2')
  } catch (err) {
    return t.fail(err)
  }
  t.deepEquals(res, out(null, null))
})

test('API without callback', async t => {
  execCb('touch ./tmp')
  await close()
  const tmpStat = await stat('./tmp')
  await unlink('./tmp')
  t.notEquals(tmpStat, null)
})

test('process cwd', async t => {
  t.deepEquals(await exec('pwd'), out(process.cwd()))
})

test('custom cwd', async t => {
  t.deepEquals(await exec('pwd', { cwd: '/' }), out('/'))
})

test('custom env variable', async t => {
  const env = { ...process.env, A: 'x', B: undefined }
  t.deepEquals(await exec('echo A: $A; echo "B: $B"', { env }), out('A: x\nB: '))
})

test('Given NODE_V8_COVERAGE env variable', async t => {
  const env = { ...process.env, NODE_V8_COVERAGE: 'a' }
  t.deepEquals(await exec('echo $NODE_V8_COVERAGE', { env }), out('a'))
})

test('Destroying NODE_V8_COVERAGE env variable', async t => {
  let formerCov = process.env.NODE_V8_COVERAGE
  delete process.env.NODE_V8_COVERAGE
  const env = { ...process.env, NODE_V8_COVERAGE: 'a' }
  t.deepEquals(await exec('echo $NODE_V8_COVERAGE', { env }), out('a'))
  process.env.NODE_V8_COVERAGE = formerCov
})

test('parallel execution', async t => {
  t.deepEquals(await Promise.all([exec('echo hi'), exec('echo ho')]), [out('hi'), out('ho')])
})

test('pid exists', async t => {
  t.type(pid(), 'number')
  t.notEquals(pid(), null)
})

test('pid unknown', async t => {
  t.equals(pid({ x: 1 }), null)
})

test('cb > exec', async t => {
  t.deepEquals(await new Promise((resolve, reject) => {
    execCb('echo hi', (error, stdout, stderr) => {
      if (error) return reject(error)
      resolve({ stdout, stderr })
    })
  }), out('hi'))
})

test('cb > closing', t => {
  closeCb(() => {
    t.end()
  })
})

test('killing the process should run', async t => {
  await exec('echo make sure a process is running!')
  process.kill(pid())
  await sleep(10)
  t.deepEquals(await exec('echo hi'), out('hi'))
})

test('Image buffer', async t => {
  const file = `${__dirname}${sep}test${sep}mutual.png`
  const { stdout } = await exec(`cat "${file}"`, { encoding: null })
  const data = await readFile(file)
  t.equals(Buffer.compare(stdout, data), 0)
})

test(' results in buffer', async t => {
  const { stdout } = await exec('echo hi', { encoding: 'base64' })
  t.ok(stdout, 'hello')
})

test('unknown encoding results in buffer', async t => {
  const { stdout } = await exec('echo hi', { encoding: `test_${Math.random().toString(16)}` })
  t.ok(Buffer.isBuffer(stdout))
})

test('process killed while running', async t => {
  const p = exec(`while true; do sleep 1; done`)
  const id = pid()
  process.kill(id)
  try {
    await p
  } catch (err) {
    t.equals(err.code, 'EDIED')
    return
  }
  t.fail('No Error thrown')
})

test('timeout', async t => {
  try {
    await exec('sleep 1', { timeout: 10 })
  } catch (err) {
    t.equals(err.code, 'ETIMEOUT')
    return
  }
  t.fail('Shouldnt be passing')
})

test('invalid timeout', async t => {
  try {
    await exec('sleep 1', { timeout: -1 })
  } catch (err) {
    t.equals(err.code, 'ERR_ASSERTION')
    return
  }
  t.fail('Shouldnt be passing')
})

test('multiple responses', async t => {
  t.deepEquals(await exec('echo a; sleep 0.1; echo b; sleep 0.1; echo c'), out('a\nb\nc'))
})

test('piping', async t => {
  t.deepEquals(await exec('echo hi | cat'), out('hi'))
})

test('escaping', async t => {
  t.deepEquals((await exec(`data=("a" "b" "c");echo "\${#data[@]}"`)), out('3'))
})

test('after', () => close())
