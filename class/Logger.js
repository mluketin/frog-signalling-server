const log4js = require('log4js');
const Config = require('../config/config');

class Logger {
  constructor() {
    const filePath = Config.logDirectory + 'frog-all.log';

    log4js.configure({
      appenders: {
        frog: {
          type: 'dateFile',
          filename: filePath,
          pattern: '.yyyy-MM-dd',
          keepFileExt: true,
          layout: {
            type: 'pattern',
            pattern: '[%d{yyyy-MM-dd hh:mm:ss:SSS O}] [%p] - %m'
          }
        },
        out: {
          type: 'stdout',
          layout: {
            type: 'pattern',
            pattern: '[%d{yyyy-MM-dd hh:mm:ss:SSS O}] [%p] - %m'
          }
        }
      },
      categories: {
        default: { appenders: ['frog', 'out'], level: 'info' }
      }
    });
    this.logger = log4js.getLogger();
  }

  trace(message) {
    this.logger.trace(message);
  }

  debug(message) {
    this.logger.debug(message);
  }

  info(message) {
    this.logger.info(message);
  }

  warn(message) {
    this.logger.warn(message);
  }

  error(message) {
    this.logger.error(message);
  }

  fatal(message) {
    this.logger.fatal(message);
  }
}

const logger = new Logger();

module.exports = logger;
