# bgbash

[![Build Status](https://travis-ci.org/martinheidegger/bgbash.svg?branch=master)](https://travis-ci.org/martinheidegger/bgbash)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![Maintainability](https://api.codeclimate.com/v1/badges/c1234051f29f448e3a40/maintainability)](https://codeclimate.com/github/martinheidegger/bgbash/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/c1234051f29f448e3a40/test_coverage)](https://codeclimate.com/github/martinheidegger/bgbash/test_coverage)

`bgbash` is a partial drop-in replacement for [`require('child_process').exec`][exec] specifically made for long-running applications.

`npm i bgbash --save`

[exec]: https://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback

## Why?

Starting a child process using `spawn` or `exec` will create a new instance of `ChildProcess`, open several streams and create a new system background process. This is very expensive if you do it often. `bgbash` starts a single background process on the the first request, every future request will use that process's `stdin` to execute commands. Reducing the startup and feedback time for subsequent calls.

### Performance comparison

The startup time is naturally accompanied with some overheads but repeat calls are up to 70% faster or create 1/3rd of the overhead. It's memory consumption is not significantly less but the memory usage fluctuates less which is a good indicator for fewer garbage-collector cycles and a lower long-term energy consumption.

| "echo hi" - 500 runs | node.js | bgback |   |
|---------------|---------|--------|---|
| startup       | 13.9ms | 21.4ms | 54% slower |
| repeat call   | 9.7ms | 9ms | 7% faster |
| cpu.user      | 9.8ms | 9.5ms | 3% faster |
| cpu.system    | 2ms | 0.6ms | 72% faster |
| mem.rss       | 23.7Mb (+1.3Mb/-3.1Mb) | 25.3Mb (+43Kb/-285Kb) | |
| mem.heapTotal | 15.1Mb (+1.1Mb/-5.4Mb) | 16.2Mb (+0b/-0b) | |
| mem.heapUsed  | 3.9Mb (+248.7Kb/-334.3Kb) | 4Mb (+83.9Kb/-174Kb) | |
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
