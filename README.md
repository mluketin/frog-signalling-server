# frog-signalling-server

This is a signalling server created for the [FROG](https://github.com/chili-epfl/FROG) platform's video chat activity.

Server can be configured by editing ./config/config.js file.

Note: Logs are saved on a machine where this server is started, but the recordings are saved on the media server. (You must give kurento user permissions on the recordings directory on the media server).

Note: There are some issues with the node_modules regarding the kurento-client dependency, so for the time being, this repository contains zipped node_modules.

Start the server by running

    sudo node server.js

Additional information is in the Wiki pages.
