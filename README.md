# TA2
Shoot aliens by yourself or with friends in your browser.

## Starting and testing a server

This program runs directly from the source code (see [Releases](https://github.com/jaxankey/TA2/releases)) so no compiling or binaries are required (other than downloading / installing [Node.js](https://nodejs.org/)). This server has been tested on Linux & Windows, but should work on OSX as well.

Linux
 1. Install [Node.js](https://nodejs.org/): For me, this meant downloading the binaries, unpacking them in a convenient folder, adding the binary path to `.profile` (with a line like `PATH=$PATH:/path/to/node/bin`) then logging out & back in.
 2. Run `./start-server-linux` (default settings) or `./start-server-linux TA2 <port>` from the terminal, where `<port>` is a TCP port, e.g., `37777`. 
 
Windows
 1. Install [Node.js](https://nodejs.org/): Download the appropriate windows installer and run it.
 2. Double-click `start-server-windows.bat`.
 3. Provide the game name and port as requested (or just hit enter a bunch to use the defaults).

A successfully booted server should declare something like `listening on port 37777` after initializing. At this point, you can test the server by opening a few Chrome browser windows side-by-side and typing in the address `localhost:37777`. 

More documentation to come...
