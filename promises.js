'use strict'
const { promisify } = require('util')
const { exec, close, pid } = require('./cb.js')

module.exports = {
  exec: (cmd, opts) => new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) {
        return reject(err)
      }
      resolve({ stdout, stderr })
    })
  }),
  close: promisify(close),
  pid
}
