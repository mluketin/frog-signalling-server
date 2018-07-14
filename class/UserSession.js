var kurento = require('kurento-client');
var logger = require('./Logger.js');
const Config = require('../config/config');
const WebRtcEndpoint = require('./WebRtcEndpoint');
const RecorderEndpoint = require('./RecorderEndpoint');

/**
 * User session represents user.
 * User has name and id; it is in room with roomName
 * There is ws connection linked to user.
 * User has pipeline that creates WebRtcEndpoints used for communication.
 *
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
      this.id = options.name;
    }
    this.ws = ws;
    this.role = options.role || 'none';
    this.pipeline = pipeline;
    this.roomName = roomName;

    this.outgoingEndpoint = null;
    this.incomingEndpoints = {};

    //recording endpoint
    this.record = options.record;
    this.recordingEndpoint;

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
    this.outgoingEndpoint = new WebRtcEndpoint(
      this.name,
      this.id,
      this.pipeline,
      eventMsg => {
        this.sendMessage(eventMsg);
      },
      () => {
        logger.info(
          'UserSession - ' +
            this.name +
            '<' +
            this.id +
            '> created outgoing endpoint'
        );
        if (this.record) {
          this.recordingEndpoint = new RecorderEndpoint(
            this.name,
            this.id,
            this.roomName,
            this.pipeline,
            recEndpoint => {
              this.outgoingEndpoint.connect(recEndpoint);
              this.recordingEndpoint.record();
            }
          );
        }
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

    if (sender.id === this.id) {
      this.outgoingEndpoint.processOffer(sender, sdpOffer, incomingEndpoint => {
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
      });
    } else {
      if (!this.incomingEndpoints[sender.id]) {
        // create incoming endpoint for new user
        this.incomingEndpoints[sender.id] = new WebRtcEndpoint(
          sender.name,
          sender.id,
          this.pipeline,
          eventMsg => {
            this.sendMessage(eventMsg);
          }
        );
      }
      this.incomingEndpoints[sender.id].processOffer(
        sender,
        sdpOffer,
        incomingEndpoint => {
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
          if (sender.id !== this.id) {
            sender.outgoingEndpoint.connect(incomingEndpoint);
          }
        }
      );
    }
  }

  reloadStreamFrom(sender, sdpOffer) {
    this.cancelVideoFromId(sender.id);
    this.receiveVideoFrom(sender, sdpOffer);
  }

  cancelVideoFromId(id) {
    if (this.incomingEndpoints[id]) {
      logger.info('PARTICIPANT ' + this.name + ': removing endpoint for ' + id);

      this.incomingEndpoints[id].release();
      delete this.incomingEndpoints[id];
    }
  }

  close() {
    logger.info('UserSession - ' + this.name + '<' + this.id + '> close');

    Object.values(this.incomingEndpoints).forEach(endpoint => {
      endpoint.release();
    });
    this.outgoingEndpoint.release();
  }

  sendMessage(message) {
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
      this.outgoingEndpoint.addCandidate(candidate);
    } else {
      if (this.incomingEndpoints[id]) {
        this.incomingEndpoints[id].addCandidate(candidate);
      }
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

  releaseOutgoingMedia() {
    this.outgoingEndpoint.release();
    this.outgoingEndpoint = undefined;
  }
}

module.exports = UserSession;
