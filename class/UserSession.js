var kurento = require('kurento-client');
var logger = require('./Logger.js');
const Config = require('../config/config');

/**
 * User session represents user.
 * User has name and id; it is in room with roomName
 * There is ws connection linked to user.
 * User has pipeline that creates WebRtcEndpoints used for communication.
 *
 *
 * @param {string} name
 * @param {string} id
 * @param {string} roomName
 * @param {WebSocket} ws
 * @param {MediaPipeline} pipeline
 */
class UserSession {
  constructor(options, roomName, ws, pipeline) {
    this.name = options.name;
    this.id = options.userId;
    if (!this.id) {
      logger.info(
        'UserSession - <null> - Id not provided for user ' +
          this.name +
          ', setting id to: ' +
          this.name
      );
      //TODO
      this.id = options.name;
    }
    this.ws = ws;
    this.role = options.role || 'none';
    this.pipeline = pipeline;
    this.roomName = roomName;

    this.outgoingMedia = null;
    this.outgoingMediaCreated = false;

    this.incomingMedia = {};
    this.incomingCandidates = {};
    this.incomingOfferProcessed = {};

    //recording endpoint
    this.record = options.record;
    this.recordingEndpoint;
    this.recordingPath =
      'file:/' +
      Config.recordingsPath +
      '/' +
      new Date().toISOString().substring(0, 10) +
      '_' +
      roomName +
      '/' +
      options.name +
      '_' +
      options.userId +
      '.webm';

    if (this.role !== 'watcher') {
      this.setUpOutgoingMedia();
    }

    logger.info(
      'UserSession - ' +
        this.name +
        '<' +
        this.id +
        '> created with role: ' +
        this.role
    );
  }

  setUpOutgoingMedia() {
    var self = this;
    //create WebRtcEndpoint for stream that is coming from user to KMS
    this.pipeline.create('WebRtcEndpoint', { useEncodedMedia: false }, function(
      error,
      webRtcEndpoint
    ) {
      if (error) {
        logger.error(
          'UserSession - <' +
            this.id +
            '> error in creating outgoing endpoint: ' +
            error
        );
      }

      logger.info(
        'UserSession - ' +
          self.name +
          '<' +
          self.id +
          '> created outgoing endpoint'
      );
      self.outgoingMedia = webRtcEndpoint;
      self.outgoingMediaCreated = true;
      if (self.record) {
        self.setUpRecording();
      }

      //when KMS creates ice candidates, send them to user
      webRtcEndpoint.on('OnIceCandidate', function(event) {
        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
        self.sendMessage({
          id: 'iceCandidate',
          name: self.name,
          userId: self.id,
          candidate: candidate
        });
        logger.trace(
          'UserSession - <' +
            self.id +
            '> sent outgoing candidate: ' +
            JSON.stringify(candidate)
        );
      });
    });
  }

  setUpRecording() {
    var self = this;

    this.pipeline.create(
      'RecorderEndpoint',
      { uri: self.recordingPath },
      function(error, recorder) {
        if (error) {
          logger.error(
            'UserSession - <' + self.id + '> setUprecording error: ' + error
          );
        }

        self.recordingEndpoint = recorder;
        self.outgoingMedia.connect(recorder);
        self.recordingEndpoint.record();

        logger.info(
          'UserSession - <' +
            self.id +
            '> created recording endpoint; file: ' +
            self.recordingPath
        );
      }
    );
  }

  /**
   * Processes offer and creates answer.
   * Sends answer to this user session.
   *
   * @param {UserSession} sender
   * @param {string} sdpOffer
   */
  receiveVideoFrom(sender, sdpOffer) {
    if (!sender) {
      logger.error(
        'UserSession - ' +
          this.name +
          '<' +
          this.id +
          '> receiveVideoFrom undefined'
      );
      return;
    }
    if (!sdpOffer) {
      logger.error(
        'UserSession - ' +
          this.name +
          '<' +
          this.id +
          '> sdpOffer is undefined or null'
      );
      return;
    }
    logger.info(
      'UserSession - ' +
        this.name +
        '<' +
        this.id +
        '> receiveVideoFrom - sdpOffer for ' +
        sender.name +
        '<' +
        sender.id +
        '>'
    );
    var self = this;

    this.getEndpointForUser(sender.id, endpoint => {
      endpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
        self.incomingOfferProcessed[sender.id] = true;
        if (error) {
          logger.error(
            'UserSession: ' +
              self.name +
              '<' +
              self.id +
              '> receiveVideoFrom getting endpoint: ' +
              error
          );
          return;
        }

        var answerMessage = {
          id: 'receiveVideoAnswer',
          userId: sender.id,
          sdpAnswer: sdpAnswer
        };

        self.sendMessage(answerMessage);
        logger.info(
          'UserSession - ' +
            self.name +
            '<' +
            self.id +
            '> receiveVideoFrom - sdpAnswer for ' +
            sender.name +
            '<' +
            sender.id +
            '>'
        );

        endpoint.gatherCandidates();

        if (sender.id !== self.id) {
          sender.getOutgoingWebRtcPeer().connect(endpoint);
          if (
            self.incomingCandidates[sender.id] &&
            self.incomingCandidates[sender.id].length > 0
          ) {
            self.incomingCandidates[sender.id].forEach(candidate => {
              endpoint.addIceCandidate(candidate);
            });
          }
        }
      });
    });
  }

  reloadStreamFrom(sender, sdpOffer) {
    this.cancelVideoFromId(sender.id);
    this.receiveVideoFrom(sender, sdpOffer);
  }

  getEndpointForUser(senderId, callback) {
    // if sender is same as this.id, we are requiring video from us => creating send only peer in the browser
    // if outgoing media does not exist, wait for it to be created
    // outgoingMedia creation is called in the UserSession constructor
    if (senderId === this.id) {
      if (this.outgoingMedia) {
        return callback(this.outgoingMedia);
      } else {
        var self = this;
        function loop() {
          setTimeout(function() {
            var outMedia = self.outgoingMedia;
            if (outMedia) {
              callback(outMedia);
            } else {
              loop();
            }
          }, 200);
        }
        return loop();
      }
    }

    var incoming = this.incomingMedia[senderId];

    if (incoming) {
      //endpoint already exists
      return callback(incoming);
    }

    //endpoint does not exist, we have to create it, creating takes time
    var self = this;
    this.pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
      if (error) {
        logger.error('UserSession - pipeline create: ' + error);
      }

      incoming = webRtcEndpoint;

      webRtcEndpoint.on('OnIceCandidate', function(event) {
        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
        self.sendMessage({
          id: 'iceCandidate',
          userId: senderId,
          candidate: candidate
        });
      });
      self.incomingMedia[senderId] = incoming;
      return callback(incoming);
    });
  }

  cancelVideoFromId(id) {
    if (this.incomingMedia[id]) {
      logger.info('PARTICIPANT ' + this.name + ': removing endpoint for ' + id);
      this.incomingMedia[id].release();
      delete this.incomingMedia[id];
      delete this.incomingOfferProcessed[id];
      delete this.incomingCandidates[id];
    }
  }

  close() {
    logger.info('UserSession - ' + this.name + '<' + this.id + '> close');

    var remoteParticipants = Object.keys(this.incomingMedia);
    for (var i = 0; i < remoteParticipants.length; i++) {
      this.incomingMedia[remoteParticipants[i]].release();
    }
    this.outgoingMedia.release();
  }

  sendMessage(message) {
    //console.log(JSON.stringify(message));
    //todo change 1 with OPEN constant
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    } else {
      logger.error(
        'UserSession - ' +
          this.name +
          '<' +
          this.id +
          '> websocket is closed; cannot send message'
      );
    }
  }

  addCandidate(candidate, id) {
    logger.trace(
      'UserSession - ' +
        this.name +
        '<' +
        this.id +
        '> addCandidate from <' +
        id +
        '> ' +
        JSON.stringify(candidate)
    );
    if (this.id === id) {
      this.getEndpointForUser(id, endpoint => {
        endpoint.addIceCandidate(candidate);
      });
    } else {
      if (this.isIncomingOfferProcessed(id)) {
        var endpoint = this.incomingMedia[id];
        endpoint.addIceCandidate(candidate);
      } else {
        this.addIncomingCandidate(candidate, id);
      }
    }
  }

  isIncomingOfferProcessed(senderId) {
    return this.incomingOfferProcessed[senderId];
  }

  addIncomingCandidate(candidate, id) {
    if (!this.incomingCandidates[id]) {
      this.incomingCandidates[id] = [candidate];
    } else {
      this.incomingCandidates[id].push(candidate);
    }
  }

  changeUserRole(userId, newRole) {
    const logMessage =
      'UserSession - ' +
      this.name +
      ' - changeUserRole for user: ' +
      userId +
      ' to role: ' +
      newRole;
    console.log(logMessage);
    if (userId === this.id) {
      if (newRole !== this.role) {
        if (this.role === 'watcher') {
          this.setUpOutgoingMedia();
        } else if (newRole === 'watcher') {
          this.releaseOutgoingMedia();
        }
        this.role = newRole;
      }
    } else {
      if (newRole === 'watcher') {
        this.cancelVideoFromId(userId);
      }
    }
    this.sendMessage({
      id: 'changeRole',
      userId: userId,
      newRole: newRole
    });
  }

  getOutgoingWebRtcPeer() {
    return this.outgoingMedia;
  }

  releaseOutgoingMedia() {
    this.outgoingMedia.release();
    this.outgoingMediaCreated = false;
    this.outgoingMedia = undefined;
  }
}

module.exports = UserSession;
