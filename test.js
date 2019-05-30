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

test('big output', async t => {
  t.deepEquals(await exec('cat package-lock.json'), {
    stdout: await readFile('package-lock.json', 'utf-8'),
    stderr: ''
  })
})

test('simple command', async t => {
  t.deepEquals(await exec('echo hi'), out('hi'))
})

test('Exit code', async t => {
  try {
    await exec('bash -c "exit 1"')
  } catch (err) {
    return t.equals(err.code, 1)
  }
  t.fail('exit didnt occur')
})

test('Error output on success is ignored', async t => {
  let res
  try {
    res = await exec('echo hi >&2')
  } catch (err) {
    return t.fail(err)
  }
  t.deepEquals(res, out(null, null))
})

test('Error output on error is returned', async t => {
  try {
    await exec('echo hi >&2 & bash -c "exit 1"')
  } catch (err) {
    t.equals(err.stderr.toString(), 'hi\n')
    t.equals(err.code, 1)
    return
  }
  t.fail('exit didnt occur')
})

test('Repeat error output is not appended', async t => {
  const [a, b] = await Promise.all([
    exec('echo hi >&2 & bash -c "exit 1"').catch(err => err),
    exec('echo ho >&2 & bash -c "exit 1"').catch(err => err)
  ])
  t.equals(a.stderr.toString(), 'hi\n')
  t.equals(b.stderr.toString(), 'ho\n')
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

test('env pairs variable', async t => {
  const env = { ...process.env, A: 'x', B: undefined }
  const envPairs = []
  for (const key in env) {
    const value = env[key]
    if (value === undefined) {
      continue
    }
    envPairs.push(`${key}=${env[key]}`)
  }
  t.deepEquals(await exec('echo A: $A; echo "B: $B"', { envPairs }), out('A: x\nB: '))
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
  execCb('echo hi', err => {
    t.equals(err, null)
    closeCb(() => {
      t.end()
    })
  })
})

test('parallel closing', async t => {
  await Promise.all([
    close(),
    close()
  ])
  t.pass('both done')
})

test('closing while the process is killed', async t => {
  await exec('echo hi') // starting a process
  const id = pid()
  let errThrown
  await Promise.all([
    exec('while true; do sleep 1; done').catch(err => {
      errThrown = err
    }),
    close(),
    new Promise((resolve, reject) => setImmediate(() => {
      try {
        process.kill(id)
        resolve()
      } catch (err) {
        reject(err)
      }
    }))
  ])
  t.notEquals(errThrown, null)
  if (errThrown) {
    t.equals(errThrown.code, 'EDIED')
  }
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

test('results in buffer', async t => {
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
