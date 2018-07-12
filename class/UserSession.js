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
    //create WebRtcEndpoint for stream that is coming from user to KMS
    this.pipeline.create('WebRtcEndpoint', (error, webRtcEndpoint) => {
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
          this.name +
          '<' +
          this.id +
          '> created outgoing endpoint'
      );
      this.outgoingMedia = webRtcEndpoint;
      this.outgoingMediaCreated = true;
      if (this.record) {
        this.setUpRecording();
      }

      //when KMS creates ice candidates, send them to user
      webRtcEndpoint.on('OnIceCandidate', event => {
        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
        this.sendMessage({
          id: 'iceCandidate',
          name: this.name,
          userId: this.id,
          candidate: candidate
        });
        logger.trace(
          'UserSession - <' +
            this.id +
            '> sent outgoing candidate: ' +
            JSON.stringify(candidate)
        );
      });
    });
  }

  setUpRecording() {
    this.pipeline.create(
      'RecorderEndpoint',
      { uri: this.recordingPath },
      (error, recorder) => {
        if (error) {
          logger.error(
            'UserSession - <' + this.id + '> setUprecording error: ' + error
          );
        }

        this.recordingEndpoint = recorder;
        this.outgoingMedia.connect(recorder);
        this.recordingEndpoint.record();

        logger.info(
          'UserSession - <' +
            this.id +
            '> created recording endpoint; file: ' +
            this.recordingPath
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

    this.getEndpointForUser(sender.id, endpoint => {
      endpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
        this.incomingOfferProcessed[sender.id] = true;
        if (error) {
          logger.error(
            'UserSession: ' +
              this.name +
              '<' +
              this.id +
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

        this.sendMessage(answerMessage);
        logger.info(
          'UserSession - ' +
            this.name +
            '<' +
            this.id +
            '> receiveVideoFrom - sdpAnswer for ' +
            sender.name +
            '<' +
            sender.id +
            '>'
        );

        endpoint.gatherCandidates();

        if (sender.id !== this.id) {
          sender.getOutgoingWebRtcPeer().connect(endpoint);
          if (
            this.incomingCandidates[sender.id] &&
            this.incomingCandidates[sender.id].length > 0
          ) {
            this.incomingCandidates[sender.id].forEach(candidate => {
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
        function loop() {
          setTimeout(() => {
            var outMedia = this.outgoingMedia;
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
    this.pipeline.create('WebRtcEndpoint', (error, webRtcEndpoint) => {
      if (error) {
        logger.error('UserSession - pipeline create: ' + error);
      }

      incoming = webRtcEndpoint;

      webRtcEndpoint.on('OnIceCandidate', event => {
        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
        this.sendMessage({
          id: 'iceCandidate',
          userId: senderId,
          candidate: candidate
        });
      });
      this.incomingMedia[senderId] = incoming;
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
