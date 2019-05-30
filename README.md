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

| "echo hi" - 2000 runs on node-v10.12.0(darwin) | node.js | bgback | notes |
|-----------------|---------|--------|---|
| startup         | 10.98ms | 16.05ms | 46% slower - The startup is naturally slower as it does a little more. |
| repeat response | 4.91ms | 1.96ms | 251% faster - But repeat calls are significantly faster, |
| repeat user     | 1.31ms | 0.95ms | 137% faster - with part of it coming from the reduced user execution time ... |
| repeat system   | 0.64ms | 0.04ms | 1457% faster - ... and a significantly reduced system execution time. |
| rss             | 37.9Mb (avg. 19.8Mb) | 9.9Mb (avg. 6.6Mb) | With a significantly lower rss memory allocation (which is stable even with more calls)  |
| heap total      | 37.5Mb (avg. 21.4Mb) | 6Mb (avg. 3.2Mb) | The node.js version also fills up the heap a lot quicker to a avg. 32Mb use at 10000 execs while the bgback version needs around 20000 to get there. |
| heap used       | 19.5Mb (avg. 6.3Mb) | 4.1Mb (avg. 1.4Mb) | The difference in size can be attributed to the additional code loaded.  This will slightly grow with number of calls (~20kb per 5000 calls). Reason is unclear but consistent for both the node.js and bgback version. |
| c-memory inc.   | 8.6Kb (avg. -201b) | 170b (avg. -7.8Kb) | The C++ memory can be negative as some initial c memory is cleared. |

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
