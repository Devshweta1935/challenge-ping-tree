process.env.NODE_ENV = 'test'

var test = require('ava')
var servertest = require('servertest')

var server = require('../lib/server')

test.serial.cb('healthcheck', function (t) {
  var url = '/health'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')

    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

test.serial.cb('POST /api/targets creates a new target', function (t) {
  var url = '/api/targets'
  var data = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: { $in: ['ca', 'ny'] },
      hour: { $in: ['13', '14', '15'] }
    }
  }
  var stream = servertest(server(), url, { method: 'POST', encoding: 'json' })
  stream.on('data', function (res) {
    let body = res.body
    if (!body && Buffer.isBuffer(res)) {
      try {
        body = JSON.parse(res.toString())
      } catch (e) {
        console.error('Failed to parse buffer as JSON:', res)
      }
    }
    if (!body) {
      console.error('DEBUG: No response body. Full response:', res)
      t.fail('No response body')
      t.end()
      return
    }
    if (body.error) {
      t.fail('API error: ' + body.error)
      t.end()
      return
    }
    t.truthy(body.id, 'response has id')
    t.end()
  })
  stream.end(JSON.stringify(data))
})

test.serial.cb('GET /api/targets returns all targets', function (t) {
  var url = '/api/targets'
  servertest(server(), url, { method: 'GET', encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.true(Array.isArray(res.body), 'response is array')
    t.true(res.body.length > 0, 'at least one target returned')
    t.truthy(res.body[0].id, 'target has id')
    t.truthy(res.body[0].url, 'target has url')
    t.end()
  })
})
