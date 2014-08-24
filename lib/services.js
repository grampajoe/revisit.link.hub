'use strict';

var fs = require('fs');
var request = require('request');
var RevisitToken = require('revisit-token');
var RevisitTether = require('revisit-tether');
var nconf = require('nconf');
var WebSocket = require('ws');
var wsServer = nconf.get('wsServer') || 'ws://ws.revisit.link';

var imageStream = require('./image-stream');
var serviceList = require('../config/services.json');

var serviceObj = {};

nconf.argv().env().file({ file: 'local.json' });

var ws = new WebSocket(wsServer);

var rvToken = new RevisitToken({
  db: './db/tokens',
  ttl: 10000
});

var rvTether = new RevisitTether({
  db: './db/tethers'
});

ws.on('open', function (ws) {
  console.log('connected to ws');
});

var existingDomain = function (domain) {
  if (serviceObj.hasOwnProperty(domain)) {
    return true;
  } else {
    return false;
  }
};

var checkServiceStatus = function (url, next) {
  var domainParts = url.split('/');
  var domain = domainParts[0] + '//' + domainParts[2];

  if (existingDomain(domain)) {
    next(null, serviceObj[domain]);
    return;
  }

  serviceObj[domain] = domain;

  request({
    method: 'HEAD',
    url: url,
    followAllRedirects: false
  }, function (err, response) {
    if (err || response.statusCode !== 200) {
      serviceObj[domain] = false;
      next(new Error('Service unavailable'));
      return;
    }

    next(null, domain);
  });
};

exports.home = function (request, reply) {
  serviceObj = {};
  reply.view('index', {
    analytics: nconf.get('analytics')
  });
};

exports.getAll = function (request, reply) {
  var count = 0;
  var serviceStatuses = [];

  var checkStatus = function (service) {
    checkServiceStatus(service.url, function (err, domain) {
      var serviceItem = {
        url: service.url,
        description: service.description,
        sample: service.sample,
        repository: service.repository,
        online: false
      };

      serviceItem.online = serviceObj[domain];
      serviceStatuses.push(serviceItem);

      if (serviceList.length < 2 || count === serviceList.length - 1) {
        rvToken.generate(function (err, token) {
          if (err) {
            throw err;
            return;
          }

          reply({
            services: serviceStatuses,
            token: token
          });
        });
      }

      count ++;
    });
  };

  serviceList.forEach(function (service) {
    setImmediate(function () {
      checkStatus(service);
    });
  });
};

exports.play = function (request, reply) {
  var play = function (services) {
    rvTether.play(request.params.token, function (err, result) {
      if (err) {
        reply.view('error', {
          reason: 'Looks like this token expired!'
        });
        return;
      }

      imageStream.addImage(result.content.data);

      try {
        ws.send(result.content.data);
      } catch (err) {
        ws = new WebSocket(wsServer);
        ws.on('open', function (ws) {
          console.log('opened');
        });

        setTimeout(function () {
          ws.send(result.content.data);
        }, 1000);
      }

      reply.view('script', {
        token: request.params.token,
        result: result.content.data,
        analytics: nconf.get('analytics')
      });
    });
  };

  rvTether.getAll(request.params.token, function (err, services) {
    if (err) {
      reply.view('error', {
        reason: 'No services seem to be associated with this token'
      });
      return;
    }

    play(services);
  });
};

exports.add = function (request, reply) {
  var count = 0;
  if (!request.payload.services || !request.payload.content) {
    reply.redirect('/?error=invalid');
    return;
  }

  var urls = request.payload.services.split(',').slice(0, 4);
  var content = request.payload.content;

  var addService = function (sv) {
    var service = {
      url: sv,
      token: request.payload.token,
      content: {
        data: content
      },
      meta: { }
    };

    rvTether.add(service, function (err, svc) {
      if (urls.length < 2 || count === urls.length - 1) {
        reply.redirect('/' + request.payload.token + '/play');
      }

      count ++;
    });
  };

  urls.forEach(function (sv) {
    setImmediate(function () {
      addService(sv);
    });
  });
};
