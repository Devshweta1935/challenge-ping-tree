var URL = require('url')
var http = require('http')
var cuid = require('cuid')
var Corsify = require('corsify')
var sendJson = require('send-data/json')
var ReqLogger = require('req-logger')
var healthPoint = require('healthpoint')
var HttpHashRouter = require('http-hash-router')

var redis = require('./redis')
var version = require('../package.json').version

var router = HttpHashRouter()
var logger = ReqLogger({ version: version })
var health = healthPoint({ version: version }, redis.healthCheck)
var cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})

router.set('/favicon.ico', empty)
router.set('/api/targets', targetsHandler)
router.set('/api/target/:id', targetByIdHandler)
router.set('/route', routeHandler)

module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  if (req.url === '/health') return health(req, res)
  req.id = cuid()
  logger(req, res, { requestId: req.id }, function (info) {
    info.authEmail = (req.auth || {}).email
    console.log(info)
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)

  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  var logType = res.statusCode >= 500 ? 'error' : 'warn'

  console[logType]({
    err: err,
    requestId: req.id,
    statusCode: res.statusCode
  }, err.message)
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}

function getQuery (url) {
  return URL.parse(url, true).query // eslint-disable-line
}

function targetsHandler (req, res) {
  if (req.method === 'POST') return createTarget(req, res)
  if (req.method === 'GET') return listTargets(req, res)
  res.writeHead(405)
  res.end('Method Not Allowed')
}

function createTarget (req, res) {
  var body = ''
  req.on('data', function (chunk) { body += chunk })
  req.on('end', function () {
    try {
      var data = JSON.parse(body)
      var id = cuid()
      var target = Object.assign({}, data, { id })
      if (typeof target.accept === 'object') {
        target.accept = JSON.stringify(target.accept)
      }
      redis.hmset('target:' + id, target, function (err) {
        if (err) return sendError(req, res, 500, 'Failed to save target')
        redis.sadd('targets', id, function (err) {
          if (err) return sendError(req, res, 500, 'Failed to index target')
          sendJson(req, res, { id })
        })
      })
    } catch (e) {
      sendError(req, res, 400, 'Invalid JSON')
    }
  })
}

function listTargets (req, res) {
  redis.smembers('targets', function (err, ids) {
    if (err) return sendError(req, res, 500, 'Failed to fetch targets')
    if (!ids.length) return sendJson(req, res, [])
    var multi = redis.multi()
    ids.forEach(function (id) {
      multi.hgetall('target:' + id)
    })
    multi.exec(function (err, targets) {
      if (err) return sendError(req, res, 500, 'Failed to fetch targets')
      sendJson(req, res, targets)
    })
  })
}

function sendError (req, res, code, msg) {
  res.statusCode = code
  sendJson(req, res, { error: msg })
}

function targetByIdHandler (req, res, ctx) {
  var id = ctx.params.id
  if (!id) {
    res.writeHead(400)
    return res.end('Missing id')
  }
  if (req.method === 'GET') return getTargetById(req, res, id)
  if (req.method === 'PUT') return updateTargetById(req, res, id)
  res.writeHead(405)
  res.end('Method Not Allowed')
}

function getTargetById (req, res, id) {
  redis.hgetall('target:' + id, function (err, target) {
    if (err) return sendError(req, res, 500, 'Failed to fetch target')
    if (!target || !target.id) return sendError(req, res, 404, 'Target not found')
    sendJson(req, res, target)
  })
}

function updateTargetById (req, res, id) {
  var body = ''
  req.on('data', function (chunk) { body += chunk })
  req.on('end', function () {
    try {
      var data = JSON.parse(body)
      delete data.id // never allow id to be overwritten
      redis.exists('target:' + id, function (err, exists) {
        if (err) return sendError(req, res, 500, 'Failed to check target')
        if (!exists) return sendError(req, res, 404, 'Target not found')
        redis.hmset('target:' + id, data, function (err) {
          if (err) return sendError(req, res, 500, 'Failed to update target')
          sendJson(req, res, { id })
        })
      })
    } catch (e) {
      sendError(req, res, 400, 'Invalid JSON')
    }
  })
}

function routeHandler (req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405)
    return res.end('Method Not Allowed')
  }
  var body = ''
  req.on('data', function (chunk) { body += chunk })
  req.on('end', function () {
    try {
      var data = JSON.parse(body)
      routeDecision(req, res, data)
    } catch (e) {
      sendError(req, res, 400, 'Invalid JSON')
    }
  })
}

function routeDecision (req, res, visitor) {
  redis.smembers('targets', function (err, ids) {
    if (err) return sendError(req, res, 500, 'Failed to fetch targets')
    if (!ids.length) return sendJson(req, res, { decision: 'reject' })
    var multi = redis.multi()
    ids.forEach(function (id) {
      multi.hgetall('target:' + id)
    })
    multi.exec(function (err, targets) {
      if (err) return sendError(req, res, 500, 'Failed to fetch targets')
      var filtered = filterTargets(targets, visitor)
      if (!filtered.length) return sendJson(req, res, { decision: 'reject' })
      filterByDailyLimit(filtered, function (err, available) {
        if (err) return sendError(req, res, 500, 'Failed to check limits')
        if (!available.length) return sendJson(req, res, { decision: 'reject' })
        var best = available.sort(function (a, b) {
          return parseFloat(b.value) - parseFloat(a.value)
        })[0]
        incrementAccept(best.id, function (err) {
          if (err) return sendError(req, res, 500, 'Failed to increment accept')
          sendJson(req, res, { decision: 'accept', url: best.url })
        })
      })
    })
  })
}

function filterTargets (targets, visitor) {
  var hour = new Date(visitor.timestamp).getUTCHours().toString()
  return targets.filter(function (target) {
    if (!target.accept) return false
    var accept
    try { accept = JSON.parse(target.accept) } catch (e) { accept = target.accept }
    var geoOk = accept.geoState && accept.geoState.$in && accept.geoState.$in.includes(visitor.geoState)
    var hourOk = accept.hour && accept.hour.$in && accept.hour.$in.includes(hour)
    return geoOk && hourOk
  })
}

function filterByDailyLimit (targets, cb) {
  var today = new Date().toISOString().slice(0, 10)
  var multi = redis.multi()
  targets.forEach(function (target) {
    multi.get('accepts:' + target.id + ':' + today)
  })
  multi.exec(function (err, counts) {
    if (err) return cb(err)
    var available = targets.filter(function (target, i) {
      var count = parseInt(counts[i] || '0', 10)
      return count < parseInt(target.maxAcceptsPerDay, 10)
    })
    cb(null, available)
  })
}

function incrementAccept (id, cb) {
  var today = new Date().toISOString().slice(0, 10)
  var key = 'accepts:' + id + ':' + today
  redis.incr(key, function (err) {
    if (err) return cb(err)
    redis.expire(key, 60 * 60 * 24, cb) // expire in 1 day
  })
}
