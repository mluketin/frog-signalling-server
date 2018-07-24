var express = require('express');
var fs = require('fs');
var http = require('http');
var https = require('https');
var kurento = require('kurento-client');
var minimist = require('minimist');
var path = require('path');
var url = require('url');
var ws = require('ws');

const Config = require('./config/config');
const Utils = require('./utils/utils');
var RoomManager = require('./class/RoomManager.js');
var Registry = require('./class/UserRegistry');
var logger = require('./class/Logger.js');

//we can load URLs from terminal
//if there are no arguments than this default URLs will be used
var argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: Config.asUri,
    ws_uri: Config.kmsUri
  }
});

var kurentoClient = null;
var roomManager = null;
var registry = new Registry();
var users = {};

var app = express();
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;

var server;
var wss;

logger.trace('Server - runned with config: ' + JSON.stringify(Config));

if (argv.as_uri.startsWith('https')) {
  //options for HTTPS server's constructor
  //this enables usage of HTTPS protocol
  var options = {
    key: fs.readFileSync(Config.httpsOptions.privateKey),
    cert: fs.readFileSync(Config.httpsOptions.certificate),
    ca: fs.readFileSync(Config.httpsOptions.caBundle)
  };

  server = https.createServer(options, app);
  wss = new ws.Server({
    server: server,
    path: Config.asUriPath
  });
} else {
  server = http.createServer(function(request, response) {
    // process HTTP request. Since we're writing just WebSockets
    // server, we don't have to implement anything.
  });

  wss = new ws.Server({
    server: server
  });
}

wss.on('connection', function(ws) {
  ws.user = undefined;

  ws.on('error', error => {
    logger.error('ws error: ' + error);
  });

  ws.on('close', () => {
    try {
      if (ws.user) {
        // normaly "leave" message will remove user from room
        logger.warn(
          'server - ws closing: ' + ws.user.name + '<' + ws.user.id + '>'
        );

        leaveRoom(ws.user);
        ws.user = undefined;
      }
    } catch (error) {
      logger.error('ws on close: ' + error);
    }
  });

  ws.on('message', function(_message) {
    var message;
    try {
      message = JSON.parse(_message);

      switch (message.id) {
        case 'logIn':
          logger.info('server - logIn - ' + message.userId);
          users[message.userId] = ws;
          break;

        case 'roomId':
          onRoomId(ws);
          break;

        case 'joinRoom':
          users[message.userId] = ws;
          addUserToRoom(message, ws);
          break;

        case 'receiveVideoFrom':
          logger.info(
            'server - receiveVideoFrom - This user: ' +
              ws.user.name +
              '<' +
              ws.user.id +
              '> wants video from: <' +
              message.userId +
              '>'
          );
          //get user by his id (message.sender is supposed to be Id of sender who will send us video)
          var sender = registry.getUser(message.userId);
          ws.user.receiveVideoFrom(sender, message.sdpOffer);
          break;

        case 'reloadStreamFrom':
          logger.info(
            'server - reloadStreamFrom - This user: ' +
              ws.user.name +
              '<' +
              ws.user.id +
              '>; wants to reset video from: ' +
              message.sender +
              '\n'
          );
          var sender = registry.getUser(message.userId);
          ws.user.reloadStreamFrom(sender, message.sdpOffer);
          break;

        case 'notifyParticipants':
          roomManager
            .getRoom(ws.user.roomName)
            .then(room => {
              if (message.payload) {
                room.notifyParticipants(message.payload);
              }
            })
            .catch(error => {
              logger.error('server - notifyParticipants - ' + error);
            });
          break;

        case 'changeRole':
          roomManager
            .getRoom(ws.user.roomName)
            .then(room => {
              room.changeUserRole(message.userId, message.newRole);
            })
            .catch(error => {
              logger.error('server - changeRole - roomManager - ' + error);
            });
          break;

        case 'leaveRoom':
          leaveRoom(ws.user);
          ws.user = undefined;
          break;

        case 'onIceCandidate':
          var candidate = message.candidate;
          if (ws.user) {
            ws.user.addCandidate(candidate, message.userId);
          } else {
            logger.error('server - onIceCandidate - user is undefined or null');
          }
          break;

        case 'info':
          logger.info(
            'server - info - message from ' +
              ws.user.id +
              '; message: ' +
              _message
          );
          break;

        case 'data':
          // idea behind data is that users send messages only with their IDs
          // there is no need for user session
          logger.info('server - data - from ' + message.fromId + _message);
          var targetUserWs = users[message.userId];
          if (targetUserWs) {
            targetUserWs.send(
              JSON.stringify({
                id: 'data',
                fromId: message.fromId,
                payload: message.payload
              })
            );
          }
          break;

        case 'logOut':
          logger.info('server - logOut - ' + message.userId);
          delete user[message.userId];
          break;

        default:
          logger.warn(
            'ws onMessage, message.id not in switch-case: ' + _message
          );
          break;
      }
    } catch (error) {
      logger.error(
        'ws onMessage, message is probably not JSON: ' +
          error +
          '; message: ' +
          _message
      );
    }
  });
});

/**
 * Generate new 6-digit room id that is not used and send it as a response.
 * Response message is {id: "roomId", roomId: roomId}
 *
 * @param {object} message received json message
 * @param {object} ws websocket used to send response message
 */
function onRoomId(ws) {
  try {
    var roomId = Utils.randomString(6);
    while (roomManager.roomExists(roomId)) {
      roomId = Utils.radomDigitsString(6);
    }
    logger.info('onRoomId: generated roomId: ' + roomId);

    //now we have unique ID
    //there is a chance that one hololens will receive unique id, and before it registers, another will also
    //receive that ID chance is 1:100000
    var roomIdMessage = {
      id: 'roomId',
      roomId: roomId
    };
    ws.send(JSON.stringify(roomIdMessage));
  } catch (error) {
    logger.error('onRoomId: ' + error);
  }
}

/**
 * Creates/retreives room, and adds user to room
 * Room will create UserSession which this function will return.
 */
function addUserToRoom(message, ws) {
  try {
    var roomId = message.room;
    logger.info(
      'server - addUserToRoom - participant ' +
        message.name +
        '<' +
        message.userId +
        '>: trying to join room <' +
        roomId +
        '>'
    );

    roomManager
      .getRoom(roomId)
      .then(room => {
        room.addUser(message, ws, registry);
      })
      .catch(error => {
        logger.error('server - addUserToRoom - roomManager - ' + error);
      });
  } catch (error) {
    logger.error('server - addUserToRoom: ' + error);
    try {
      ws.send(
        JSON.stringify({
          id: 'error',
          message: 'Error in joinRoom ' + error
        })
      );
    } catch (error2) {
      logger.error('server - addUserToRoom - trycatch: ' + error2);
    }
  }
}

/**
 * User leaves room.
 * Other participants in a room are notified of that user leaving.
 * If room does not have any participants left, it closes.
 *
 * @param {UserSession} user UserSession
 */
function leaveRoom(user) {
  try {
    if (user) {
      logger.info(
        'server - leaveRoom - user: ' +
          user.name +
          '<' +
          user.id +
          '> is leaving room : ' +
          user.roomName
      );
      roomManager
        .getRoom(user.roomName)
        .then(room => {
          room.removeUser(user);
          if (room.isEmpty()) {
            roomManager.removeRoom(room);
          }
        })
        .catch(error => {
          logger.error(
            'server - leaveRoom - user: ' +
              user.name +
              '<' +
              user.id +
              '>: ' +
              error
          );
        });
    } else {
      logger.error('server - leaveRoom - User does not exist for leaveRoom!');
    }
  } catch (error) {
    logger.error('server - leaveRoom: ' + error);
  }
}

// now we retreive kurento client and start server
// must be with callback, not promise based
kurento(argv.ws_uri, (error, _kurentoClient) => {
  if (error) {
    logger.fatal(
      'server - kurento - could not find media server at address ' + argv.ws_uri
    );
    return;
  }
  logger.info('server - Kurento client created');

  kurentoClient = _kurentoClient;
  roomManager = new RoomManager(kurentoClient);

  server.listen(port, () => {
    logger.info('Server - started');
    logger.info('Server - available at ' + url.format(asUrl));
  });

  //create static server (everything in static folder will be served if requested)
  // app.use(express.static(path.join(__dirname, 'static')));

  // the code below enables file download
  // app.get('/download', function(req, res) {
  //   var file = 'FILE_PATH';
  //   res.download(file); // Set disposition and send it.
  // });
});
