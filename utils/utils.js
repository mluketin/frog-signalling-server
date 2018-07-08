class Utils {
  constructor() {}

  randomString(len) {
    var randomString = '';
    try {
      var charSet = '0123456789';
      for (var i = 0; i < len; i++) {
        var randomPoz = Math.floor(Math.random() * charSet.length);
        randomString += charSet.substring(randomPoz, randomPoz + 1);
      }
    } catch (error) {
      console.log('radomDigitsString: ' + error);
    }
    return randomString;
  }
}

var utils = new Utils();

module.exports = utils;
