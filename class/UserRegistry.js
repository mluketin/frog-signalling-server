class UserRegistry {
  constructor() {
    this.users = {};
  }

  register(userSession) {
    if (userSession) {
      this.users[userSession.id] = userSession;
    } else {
      logger.error('UserRegistry - register - userSession is undefined');
    }
  }

  getUser(userId) {
    return this.users[userId];
  }

  exists(userId) {
    if (this.users[userId]) {
      return true;
    }
    return false;
  }

  removeUser(userSession) {
    var user = this.users[userSession.id];
    delete this.users[userId];
    return user;
  }

  removeUserById(userId) {
    var user = this.users[userId];
    delete this.users[userId];
    return user;
  }
}

module.exports = UserRegistry;
