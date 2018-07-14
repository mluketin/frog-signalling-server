var logger = require('./Logger.js');
const Config = require('../config/config');

class RecorderEndpoint {
  // recorder endpoint gets name, id and room of the UserSession
  constructor(name, id, room, pipeline, onCreated) {
    this.name = name;
    this.id = id;
    this.room = room;
    this.pipeline = pipeline;
    this.onCreated = onCreated;
    this.recorderEndpoint = null;
    this.recordingPath =
      'file:/' +
      Config.recordingsPath +
      '/' +
      new Date().toISOString().substring(0, 10) +
      '_' +
      room +
      '/' +
      name +
      '_' +
      id +
      '.webm';

    this.createRecorderEndpoint();
  }

  createRecorderEndpoint() {
    this.pipeline.create(
      'RecorderEndpoint',
      { uri: this.recordingPath },
      (error, recorder) => {
        if (error) {
          logger.error(
            'UserSession - ' +
              this.name +
              '<' +
              this.id +
              '> setUpRecording error: ' +
              error
          );
        }

        this.recorderEndpoint = recorder;

        logger.info(
          'UserSession - ' +
            this.name +
            '<' +
            this.id +
            '> created recording endpoint; file: ' +
            this.recordingPath
        );

        this.onCreated(this.recorderEndpoint);
      }
    );
  }

  record() {
    this.recorderEndpoint.record();
  }
}

module.exports = RecorderEndpoint;
