var UserSession = require('./UserSession.js');
var logger = require('./Logger.js');

/**
 * Room contains participants that are in conversation.
 * Room has a name and a pipeline (media pipeline).
 *
 * Room can:
 *      - join user to room
 *      - leave user from room
 *      - close room
 *
 * @param {string} name
 * @param {MediaPipeline} pipeline
 */
class Room {
  constructor(id, pipeline) {
    this.id = id;
    this.participants = {};
    this.pipeline = pipeline;
    logger.info('Room - <' + this.id + '> created room');
  }

  /**
   * Adds user to participant list
   * @param {WebSocket} ws
   * @returns {UserSession} user as UserSession
   */
  addUser(options, ws, registry) {
    // if user is already joind in the room
    // remove that user and add the new one
    if (this.participants[options.userId]) {
      const user = this.participants[options.userId];

      logger.info(
        'Room - <' +
          this.id +
          '> ' +
          user.name +
          '<' +
          user.id +
          '> is already in the room, kick user out and notify others'
      );
      user.ws.user = undefined;
      user.sendMessage({
        id: 'alert',
        alertId: 'otherLogin',
        message: 'someone logged in with your name on another device'
      });
      this.removeUser(user);
    }

    logger.info('Room - <' + this.id + '> adding participant ' + options.name);
    var participant = new UserSession(options, this.id, ws, this.pipeline);
    registry.register(participant);
    ws.user = participant;

    //notify other participants that new participant has joined room
    const newParticipantMsg = {
      id: 'newParticipantArrived',
      name: participant.name,
      userId: participant.id,
      role: participant.role
    };
    logger.info(
      'Room - <' +
        this.id +
        '> notifying participants (' +
        Object.values(this.participants).length +
        ') of new participant ' +
        participant.name +
        '<' +
        participant.id +
        '>'
    );

    Object.values(this.participants).forEach(p => {
      try {
        p.sendMessage(newParticipantMsg);
      } catch (error) {
        logger.error(
          'Room - <' +
            this.id +
            '> participant ' +
            p.name +
            ' could not be notified'
        );
      }
    });

    //send names of existing participants to new participant
    var existingParticipantsMsg = {
      id: 'existingParticipants',
      data: Object.values(this.participants)
        //        .filter(p => p.role !== 'watcher')
        .map(p => ({ name: p.name, id: p.id, role: p.role }))
    };
    logger.info(
      'Room - <' +
        this.id +
        '> participant: ' +
        participant.name +
        '<' +
        participant.id +
        '> sending a list of participants: ' +
        JSON.stringify(existingParticipantsMsg.data)
    );
    participant.sendMessage(existingParticipantsMsg);

    //add participant to list to collection of participants for this room
    this.participants[participant.id] = participant;
    return participant;
  }

  notifyParticipants(message) {
    Object.values(this.participants).forEach(p => p.sendMessage(message));
  }

  changeUserRole(userId, newRole) {
    console.log(
      'Room: changeUserRole; num of participants: ' +
        Object.values(this.participants).length
    );
    Object.values(this.participants).forEach(p =>
      p.changeUserRole(userId, newRole)
    );
  }

  /**
   * Removes given participant from room.
   * Notifies other users that participant left room.
   *
   * @param {UserSession} user
   */
  removeUser(user) {
    logger.info(
      'Room - <' +
        this.id +
        '> ' +
        user.name +
        '<' +
        user.id +
        '> is leaving room'
    );
    delete this.participants[user.id];

    //notify other users in a room that this user is leaving
    logger.info(
      'Room - <' +
        this.id +
        '> notifying all users that ' +
        user.name +
        '<' +
        user.id +
        '> is leaving the room'
    );
    var participantLeftJson = {
      id: 'participantLeft',
      userId: user.id
    };
    var unnotifiedParticipants = [];

    Object.values(this.participants).forEach(p => {
      try {
        p.cancelVideoFromId(user.id);
        p.sendMessage(participantLeftJson);
      } catch (error) {
        logger.error('CancelVideoFrame error: ' + error);
        unnotifiedParticipants.push(p.name);
      }
    });

    if (unnotifiedParticipants.length !== 0) {
      logger.error(
        'Room - <' +
          this.id +
          '> The users ' +
          unnotifiedParticipants +
          ' could not be notified that ' +
          user.id +
          ' left the room'
      );
    }

    //close user
    user.close();
  }

  /**
   * Closes room:
   *  - closes each of the participants in a room.
   *  - releases pipeline
   */
  close() {
    Object.values(this.participants).forEach(p => {
      try {
        p.close();
      } catch (error) {
        logger.error(
          'ROOM ' +
            this.id +
            ': Could not invoke close on participant ' +
            p.name
        );
      }
    });

    this.participants = {};
    this.pipeline.release();
    logger.info('Room - <' + this.id + '> closed');
  }

  isEmpty() {
    return Object.values(this.participants).length === 0;
  }
}

module.exports = Room;
