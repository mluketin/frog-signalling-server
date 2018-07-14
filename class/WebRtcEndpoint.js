var kurento = require('kurento-client');
var logger = require('./Logger.js');

class WebRtcEndpoint {
  // WebRtcEndpoint receives pipeline and callback function
  // callback function will be called when endpoint generates
  //   sdp message or ice candidate
  // name and id belong to the participant represented by the endpoint
  // onCreated is called when webrtc endpoint is created
  constructor(name, id, pipeline, onEvent, onCreated) {
    this.name = name;
    this.id = id;
    this.pipeline = pipeline;
    this.onEvent = onEvent;
    this.onCreated = onCreated;
    this.webRtcEndpoint = null;
    this.offerProcessed = false;
    this.remoteCandidates = [];

    this.createWebRtcEndpoint();
  }

  createWebRtcEndpoint() {
    this.pipeline.create('WebRtcEndpoint', (error, webRtcEndpoint) => {
      if (error) {
        logger.error(
          'Endpoint error - ' + this.name + '<' + this.id + '>' + error
        );
      }

      this.webRtcEndpoint = webRtcEndpoint;

      //when KMS creates ice candidates, send them to user
      webRtcEndpoint.on('OnIceCandidate', event => {
        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
        this.onEvent({
          id: 'iceCandidate',
          userId: this.id,
          candidate: candidate
        });
      });

      if (this.onCreated) {
        this.onCreated();
      }
    });
  }

  connect(endpoint) {
    this.webRtcEndpoint.connect(endpoint);
  }

  addCandidate(candidate) {
    if (this.offerProcessed) {
      this.webRtcEndpoint.addIceCandidate(candidate);
    } else {
      this.remoteCandidates.push(candidate);
    }
  }

  // to process offer, webRtcEndpoint must be created
  // sometimes, offer can come before kurento creates the endpoint
  processOffer(sender, offer, onComplete) {
    if (!this.webRtcEndpoint) {
      setTimeout(() => {
        this.processOffer(sender, offer, onComplete);
      }, 100);
    } else {
      this.webRtcEndpoint.processOffer(offer, (error, sdpAnswer) => {
        this.offerProcessed = true;
        if (error) {
          logger.error(
            'Endpoint error - ' + this.name + '<' + this.id + '>' + error
          );
          return;
        }

        this.onEvent({
          id: 'receiveVideoAnswer',
          userId: sender.id,
          sdpAnswer: sdpAnswer
        });

        this.webRtcEndpoint.gatherCandidates();

        if (onComplete) {
          onComplete(this.webRtcEndpoint);
        }

        if (this.remoteCandidates.length > 0) {
          this.remoteCandidates.forEach(candidate => {
            this.webRtcEndpoint.addIceCandidate(candidate);
          });
        }
      });
    }
  }

  release() {
    this.webRtcEndpoint.release();
  }
}

module.exports = WebRtcEndpoint;
