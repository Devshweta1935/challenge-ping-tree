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

test.serial.cb('GET /api/target/:id returns a target by id', function (t) {
  var createUrl = '/api/targets'
  var data = {
    url: 'http://example.com/2',
    value: '0.75',
    maxAcceptsPerDay: '5',
    accept: {
      geoState: { $in: ['tx'] },
      hour: { $in: ['10', '11'] }
    }
  }
  var stream = servertest(server(), createUrl, { method: 'POST', encoding: 'json' })
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
    var id = body.id
    var getUrl = '/api/target/' + id
    servertest(server(), getUrl, { method: 'GET', encoding: 'json' }, function (err, res2) {
      t.falsy(err, 'no error')
      t.is(res2.body.id, id, 'id matches')
      t.is(res2.body.url, data.url, 'url matches')
      t.end()
    })
  })
  stream.end(JSON.stringify(data))
})

test.serial.cb('PUT /api/target/:id updates a target', function (t) {
  var createUrl = '/api/targets'
  var data = {
    url: 'http://example.com/3',
    value: '0.80',
    maxAcceptsPerDay: '8',
    accept: {
      geoState: { $in: ['fl'] },
      hour: { $in: ['12'] }
    }
  }
  var stream = servertest(server(), createUrl, { method: 'POST', encoding: 'json' })
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
    var id = body.id
    var updateUrl = '/api/target/' + id
    var update = { value: '0.99', url: 'http://updated.com' }
    var updateStream = servertest(server(), updateUrl, { method: 'POST', encoding: 'json' })
    updateStream.on('data', function (res2) {
      let body2 = res2.body
      if (!body2 && Buffer.isBuffer(res2)) {
        try {
          body2 = JSON.parse(res2.toString())
        } catch (e) {
          console.error('Failed to parse buffer as JSON:', res2)
        }
      }
      if (!body2) {
        console.error('DEBUG: No response body. Full response:', res2)
        t.fail('No response body')
        t.end()
        return
      }
      t.is(body2.id, id, 'id matches after update')
      servertest(server(), updateUrl, { method: 'GET', encoding: 'json' }, function (err, res3) {
        t.falsy(err, 'no error')
        t.is(res3.body.value, '0.99', 'value updated')
        t.is(res3.body.url, 'http://updated.com', 'url updated')
        t.end()
      })
    })
    updateStream.end(JSON.stringify(update))
  })
  stream.end(JSON.stringify(data))
})
