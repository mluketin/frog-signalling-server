class Config {
  constructor() {
    // URL for the signalling server
    // this.asUri = 'http://localhost:8080/';
    this.asUri = 'https://localhost:443/';

    // path for the signalling server's URL
    // example if path is "test" then you access the server with
    //   ws://<ip>:<port>/test
    this.asUriPath = '/';

    // 8888 is default, check KMS config for exact information
    this.kmsUri = 'ws://frog-marin.tk:8888/kurento';

    // kurento user must have permissions for the directory where recordings are stored
    this.recordingsPath = '/home/kurento/recordings/';

    // ssl files paths
    this.httpsOptions = {
      privateKey: 'private.key',
      certificate: 'certificate.crt',
      caBundle: 'ca_bundle.crt'
    };

    // directory in which logs are saved
    this.logDirectory = 'logs/';
  }
}

var config = new Config();

module.exports = config;
