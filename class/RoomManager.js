const Room = require('./Room.js');
const logger = require('./Logger.js');

/**
 * RoomManager has collection of rooms and has KurentoClient.
 * It can get/create room, check if room exists, close room.
 * Rooms are identified by roomId, which is a unique string.
 * Each room MUST HAVE unique roomId.
 *
 * When room is created, KurentoClient will create MediaPipeline and pass it in constructor.
 *
 * NOTE: there is possibility that two users try to enter a room that does not exist
 *
 * roomsInCreation is used to mark rooms that are being created, while room is being created,
 * other user waits for the room
 *
 * @param {KurentoClient} kurentoClient
 */
class RoomManager {
  constructor(kurentoClient) {
    this.rooms = {};
    this.roomInCreation = {};
    this.kurentoClient = kurentoClient;
    logger.info('RoomManager - created');
  }

  roomExists(id) {
    if (this.rooms[id]) {
      return true;
    }
    return false;
  }

  getRoom(id) {
    return new Promise((resolve, reject) => {
      var room = this.rooms[id];

      if (room) {
        resolve(room);
      } else {
        if (this.roomInCreation[id]) {
          var self = this;
          const loop = () => {
            setTimeout(() => {
              var room = self.rooms[id];
              if (room) {
                resolve(room);
              } else if (self.roomInCreation[id]) {
                loop();
              } else {
                //room is undefined and not in creation
                self
                  .getRoom(id)
                  .then(room => resolve(room))
                  .catch(error => reject(error));
              }
            }, 200);
          };
          loop();
        } else {
          this.roomInCreation[id] = true;
          this.kurentoClient
            .create('MediaPipeline', { useEncodedMedia: false })
            .then(pipeline => {
              room = new Room(id, pipeline);
              this.rooms[id] = room;
              this.roomInCreation[id] = false;
              resolve(room);
            })
            .catch(error => {
              reject(error);
            });
        }
      }
    });
  }

  removeRoom(room) {
    delete this.rooms[room.id];
    delete this.roomInCreation[room.id];
    room.close();
  }
}

module.exports = RoomManager;
