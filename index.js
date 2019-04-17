'use strict'
const { exec, close, pid } = require('./cb.js')
const promises = require('./promises.js')

module.exports = {
  exec, close, pid, promises
}
