const WebRtcConfig = {
  rtcConfiguration: {
    iceServers: [
      {
        urls: 'stun:<STUN_URL>'
      },
      {
        urls: 'turn:<TURN_URL>',
        username: '<TURN_USERNAME>',
        credential: '<TURN_PASS>'
      }
    ]
  },
  signalServerURL: '<SIGNALLING_SEVER_URL>',
  mediaConstraints: {
    audio: true,
    video: {
      width: { ideal: 320 },
      frameRate: { ideal: 15 }
    }
  }
};
