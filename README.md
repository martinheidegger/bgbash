# bgbash

[![Build Status](https://travis-ci.org/martinheidegger/bgbash.svg?branch=master)](https://travis-ci.org/martinheidegger/bgbash)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Maintainability](https://api.codeclimate.com/v1/badges/0515ec5a0831b36b5992/maintainability)](https://codeclimate.com/github/martinheidegger/bgbash/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/0515ec5a0831b36b5992/test_coverage)](https://codeclimate.com/github/martinheidegger/bgbash/test_coverage)

`bgbash` is a partial drop-in replacement for [`require('child_process').exec`][exec] specifically made for long-running applications.

`npm i bgbash --save`

[exec]: https://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback

## Why?

Starting a child process using `spawn` or `exec` will create a new instance of `ChildProcess`, open several streams and create a new system background process. This is very expensive if you do it often. `bgbash` starts a single background process on the the first request, every future request will use that process's `stdin` to execute commands. Reducing the startup and feedback time for subsequent calls.

### Performance comparison

The startup time is naturally accompanied with some overheads but repeat calls are up to 70% faster or create 1/3rd of the overhead. It's memory consumption is not significantly less but the memory usage fluctuates less which is a good indicator for fewer garbage-collector cycles and a lower long-term energy consumption.

| "echo hi" - 500 runs | node.js | bgback |   |h
|---------------|---------|--------|---|
| startup       | 11.1ms | 22.2ms | 100% slower |
| repeat call   | 8.2ms | 7.6ms | 7% faster |
| cpu.user      | 9.3ms | 8.7ms | 6% faster |
| cpu.system    | 1.8ms | 0.5ms | 72% faster |
| mem.rss       | 23.5Mb (+1.4Mb/-2.9Mb) | 24.9Mb (+225.4Kb/-374.6Kb) | |
| mem.heapTotal | 14.5Mb (+1.7Mb/-4.8Mb) | 15.2Mb (+511Kb/-1Kb) | |
| mem.heapUsed  | 3.9Mb (+248.7Kb/-333Kb) | 4.1Mb (+92Kb/-180.7Kb) | |
| mem.external  | 8.2Kb (+8Kb/-66b) | 8.1Kb (+65b/-5b) | |

_Note:_ This data is compiled using the [`./perf.js`](./perf.js) script.

## API compatibility

The API of `exec` is implemented to be a reasonable _(but not feature complete)_ drop-in replacement for node's native `exec`.

```javascript
const { exec } = require('bgbash')

const cmd = 'echo hi'
const opts = { // (optional)
  cwd: '.',             // (optional) Path in which the code is to be executed, defaults to `process.cwd()`.
  env: { KEY: 'value' } // (optional) Environment variables to be used for the execution.
  timeout: 100,         // (optional) Time in milliseconds until a timeout appear, defaults to `0` = no timeout.
  encoding: 'utf8',     // (optional) Encoding to be used, an unknown or `null` encoding returns a Buffer.
}

exec(cmd, opts, (error, stdout, stderr) => {
  error // Error that might occur, i.e. TIMEOUT or of the process died.
  stdout // Output of the execution
  stderr // Error of the execution
})
```

A notable incompatibility is that `stderr` will be empty, even though output might exist, if no error occurs.
This is done for performance reasons.

## Closing at shutdown

The background process will continue to **run forever**. If you want the process to close, you have to run `close()`.

```javascript
const { exec, close } = require('bgbash')

exec('echo hi')
close( // Will be executed after the previous command completed!
  () => {
    // All closed!
  }
)
```

## Promises API

Much like node js, `bgbash` also comes with a Promise API that is available using either `require('bgbash').promises`
or `require('bgbash/promises')`.

```javascript
const { exec } = require('bgbash').promises
const opts = { /* Same options as above. */ }
const { stdout, stderr } = await exec('echo hi', opts)

try {
  await exec('exit 1', opts)
} catch (error) {
  // Error that happened.
}
```

### License

[MIT](./LICENSE)
