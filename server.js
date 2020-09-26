/**
 * This file is part of the TA2 distribution 
 * Copyright (c) 2015-2020 Jack Childress (Sankey).
 * 
 * This program is free software: you can redistribute it and/or modify  
 * it under the terms of the GNU General Public License as published by  
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of 
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU 
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License 
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
// Versions included in external_scripts
jquery_version    = 'jquery-3.5.1.min.js';
pixi_version      = 'pixi.min.js';
howler_version    = 'howler.min.js';

// requirements
var fs   = require('fs');                     // file system stuff
var app  = require('express')();              // routing handler
var http = require('http').createServer(app); // listening
var io   = require('socket.io')(http);        // fast input/output
var fun  = require('./common/fun');           // My common functions

// Game state defaults; can be changed by users
var state_defaults = {
  'playing':           false,    // Whether we're playing or paused
  'game_width':         1920,    // Width of the field (px)
  'game_height' :       1080,    // Height of the field
  'game_speed' :        2.0,     // Overall game speed

  'aliens_per_player' :        77, // How many aliens each player has
  'splodalien_probability' : 0.05, // Fraction of aliens that explode  
  'scale_sprite' :            3.0, // How much to scale the images
  'scale_radius' :            1.1, // How much to scale the nominal radii of the players and aliens (regular push, not damage)
  'max_push' :                  2, // Maximum distance we're allowed to push (times delta) each frame
  'push_scale' :             1e-4, // Prefactor on push strength
  
  'rounds_sploder_damage_scale': 0.2,
  'rounds_sploder_radius':        25,
  'rounds_player_harm_scale':      0, // Fractional scale for how much your ammo can hurt you.

  'damage_multiplier' :     1,    // How much to scale up the damage.

  'score' :                 0,    // Points
  'kill_rate' :             0,    // Kills per second
  'kill_rate_scale' :     100,  // Overall scale.
  't_last_kill' :           0,    // Elapsed time since last kill
  't_kill_rate_lifetime' : 3000, // Filter time constant on the kill rate

  't_update_delay' :        1000,  // How long to wait afert the last update to send the next
  't_respawn_delay' :       1000,  // How long to wait (at the beginning of the game) for aliens to respawn
  't_respawn_halflife' :    1.5e5, // How long the t_respawn_delay decays
  't_player_hit_delay' :    300,   // How long a delay between player hits
  
  't_simulated_lag' :          0,  // How long to wait before processing packets
  't_sync_ping_delay' :     1000,  // How long to wait in between sync pings.
  't_error_correction' :     700,  // How long to smooth out discrepancies
 
  't_item_delay' :          10000, // How long between items appearing
  'n_health':                   2, // How many healths exist

  'mode_teamwork':              0, // If we're in "teamwork mode"

  'role_names' :            ['Observer', 'Blue', 'Red', 'Yellow', 'Violet'],
  
  'enabled_player_ids' :    [false, false, false, false], // id's of players in game
  'players' :               [false, false, false, false], // One player packet per player_color
  'aliens' :                [false, false, false, false], // One list of alien packets per player_color
}
var state_keys_no_set = ['clients', 'playing', 'role_names', 'enabled_player_ids', 'players', 'aliens'];


// Everything about the current game state, indexed by id
let state = {'clients': {}}; 

// Set the initial state without messing up the clients
function reset_game() {
  fun.log_date('Resetting game...');

  // Set the defaults
  for(var key in state_defaults) state[key] = state_defaults[key];

  // Now send all the clients this info
  for(id in state.clients) send_state(id);
}
reset_game();


// port upon which the server listens
fun.log_date('\nArguments:');
for(var n in process.argv) fun.log_date(process.argv[n]);

// find out if a game name and port was supplied
game_name = process.argv[2];
port      = parseInt(process.argv[3]);

if(game_name == '0') game_name = 'TA2';
if(port      ==  0 ) port      = 38000;

// get the directories
var root_directory     = process.cwd();

// This is the order of searching for files.
var private_directory  = root_directory + '/private/'  + game_name
var games_directory    = root_directory + '/games/'    + game_name;
var common_directory   = root_directory + '/common';

// change to the root directory
fun.log_date('\nSearch Order:');
fun.log_date('  '+private_directory);
fun.log_date('  '+games_directory);
fun.log_date('  '+common_directory);
fun.log_date('  '+root_directory+'\n');

/**
 * See if the full path exists.
 * @param {string} path 
 */
function file_exists(path) { return fs.existsSync(path); }

/**
 * Returns the path to the appropriate file, following the priority
 * private_directory, games_directory, common_directory
 */
function find_file(path) {
  //fun.log_date(' Searching for', path, 'in');
  var paths = [
    private_directory +'/'+path,
    games_directory   +'/'+path,
    common_directory  +'/'+path,
    root_directory    +'/'+path
  ] 
  
  for(var n in paths) {
    //fun.log_date('  ', paths[n]);
    if(file_exists(paths[n])) return paths[n];
  }
  fun.log_date('  FILE NOT FOUND:', path);
  return common_directory+'/images/nofile.png';
}

/**
 * Searches for the path, and, if found, sends it using the response object
 * @param {response} response
 * @param {path-like string} path 
 */
function send(response, path) {
  var full_path = find_file(path);
  if(full_path) response.sendFile(full_path);
}

function html_encode(s) {
  // Thanks Stack Exchange.
  return s.replace(/[\u00A0-\u9999<>\&]/gim, function(i) {return '&#'+i.charCodeAt(0)+';';});
}



///////////////////
// FILE REQUESTS //
///////////////////

// External Scripts
app.get('/external_scripts/pixi.js', function(request, response) {
  response.sendFile(root_directory + '/external_scripts/' + pixi_version); } );

app.get('/socket.io.js', function(request, response) {
  response.sendFile(root_directory + '/node_modules/socket.io-client/dist/socket.io.js'); } );

app.get('/socket.io.js.map', function(request, response) {
  response.sendFile(root_directory + '/node_modules/socket.io-client/dist/socket.io.js.map'); } );
  
app.get('/external_scripts/jquery.js', function(request, response) {
  response.sendFile(root_directory + '/external_scripts/' + jquery_version); } );

app.get('/external_scripts/howler.js', function(request, response) {
  response.sendFile(root_directory + '/external_scripts/' + howler_version); } );
  
app.get('/',          function(request, response) {send(response, 'index.html')    ;} );
app.get('/rules/',    function(request, response) {send(response, 'rules.html')    ;} );
app.get('/controls/', function(request, response) {send(response, 'controls.html') ;} );
app.get('/:f',        function(request, response) {send(response, request.params.f);} );

app.get('/:z/:i',       function(request, response) {send(response, request.params.z+'/'+request.params.i                                          );} );
app.get('/:z/:d/:i',    function(request, response) {send(response, request.params.z+'/'+request.params.d+'/'+request.params.i                     );} );
app.get('/:z/:a/:b/:c', function(request, response) {send(response, request.params.z+'/'+request.params.a+'/'+request.params.b+'/'+request.params.c);} );
app.get('/common/avatars/:i', function(request, response) {send(response, 'common/avatars/' +request.params.i);} );
app.get('/private/avatars/:i',function(request, response) {send(response, 'private/avatars/'+request.params.i);} );



////////////////////////////
// Lag simulator
////////////////////////////

function simulate_lag_in(handler, data) {

  // If we have a simulated lag, delay the handling of this data
  // Note I think it would be a bad simulation if we allow this lag to vary here,
  // because this would re-order the data, which is ensured to be in order by the TCP 
  // protocol.
  if(state.t_simulated_lag) setTimeout(function(){handler(data)}, state.t_simulated_lag);
  
  // Otherwise, just run the handler on the data.
  else handler(data);
}

function simulate_lag_out(socket, key, data) {
  if(socket) {
    if(state.t_simulated_lag) setTimeout(function(){socket.emit(key,data)}, state.t_simulated_lag);
    else                                            socket.emit(key,data);
  }
}



///////////////////////////////////////////
// Thread for what to do with new client //
///////////////////////////////////////////

var sockets     = {}; // Socket objects, sorted by id
var last_id     = 1;  // Last assigned id
var t_last_item = 0;  // Time of last item.
var t_pause     = 0;  // Time of last pause event (used to not let timers progress)

var first_names = ['pants', 'n00b', '1337', '14|V|3x0r', 'dirt', 
                   'trash', 'no', 'terrible'];
var last_names  = ['tastic', 'cakes', 'pants', 'face', 'n00b', 
                   'h4x0r', 'bag', 'hole', 'friends', 'skillet',
                   'person'];

// Sends the game state to the specified client id
function send_state(id) {
  fun.log_date('Sending state to', id);

  // Send it
  simulate_lag_out(sockets[id], 'state', [id, state]);
}     

fun.log_date('SETTING UP CONNECTION');

io.on('connection', function(socket) {

  // Put the id somewhere safe.
  socket.id = last_id++;

  // Save this socket, sorted by id
  sockets[socket.id] = socket;

  // Add a new client to the list
  if(state.clients) {
    state.clients[socket.id] = {
      'id'     : socket.id, 
      'name'   : fun.random_array_element(first_names)+fun.random_array_element(last_names),
      'role'   : 0
    };
    fun.log_date('NEW CLIENT:', state.clients[socket.id]);
  } else {
    fun.log_date('ERROR: state.clients does not exist on connection.');
  }
  
  // Summarize existing state.clients
  for(n in state.clients) fun.log_date(' ', n, state.clients[n]);

  // Tests
  socket.on('io', function(data) {
    fun.log_date('TEST io', data); 
    io.emit('io', data); 
  });
  socket.on('socket', function(data) {
    fun.log_date('TEST socket', data); 
    socket.emit('socket', data); 
  });
  socket.on('broadcast', function(data) {
    fun.log_date('TEST broadcast', data); 
    socket.broadcast.emit('broadcast', data); 
  });

  ////////////////////////////
  // Queries sent by client
  ////////////////////////////

  // Client asked for game state
  function on_hallo(name) {
    fun.log_date(socket.id, 'Received_hallo', name);
    
    // Update the client name
    if(name != '' && socket && state.clients) state.clients[socket.id].name = name;

    // Send the game state
    send_state(socket.id);

    // Tell everyone else the client list socket.brodcast.emit is not working
    for (id in state.clients) { if(id != socket.id) {
      simulate_lag_out(sockets[id], 'clients', state.clients);
    }}
  }
  socket.on('hallo', function(data) {simulate_lag_in(on_hallo, data)});


  // Time request
  function on_t() {
    fun.log_date(socket.id, 'Received_t');
    simulate_lag_out(socket, 't', Date.now());
  }
  socket.on('t', function() {simulate_lag_in(on_t)});



  // Role or name change from clients
  function on_clients(clients) {
    fun.log_date(socket.id, 'Received_clients');

    // Update the clients list
    if(clients) state.clients = clients;
    else fun.log_date('  ERROR: no clients provided!');

    // Send the game state
    simulate_lag_out(io, 'clients', clients);
  }
  socket.on('clients', function(data) {simulate_lag_in(on_clients, data)});



  // New game request
  function on_new_game(state_header) {
    fun.log_date(socket.id, 'Received_new_game', state_header);

    // Replace our existing state
    state = state_header;
    
    // Wipe out the existing packet lists and create new ones
    state.players = [];
    state.aliens  = [];
    for(var n=0; n<state.enabled_player_ids.length; n++) {
      
      // Create a blank packet for each player
      state.players.push(fun.create_blank_packet());

      // Create a list of blank packets for each alien
      state.aliens.push([]);
      for(var m=0; m<state.aliens_per_player; m++)
        state.aliens[n].push(fun.create_blank_packet());
    }

    // We are going to start playing. :)
    state.playing = true;

    // Reset the score, kill rate, etc
    state['score']       = 0;          // Points
    state['kill_rate']   = 0;          // Kills per second

    // Reset the item clock
    t_last_item = Date.now();
  
    // Just relay it to everyone. Let them handle setup!
    simulate_lag_out(io, 'new_game', state);
  }
  socket.on('new_game', function(data) {simulate_lag_in(on_new_game, data)});



  // received a chat message
  function on_chat(message) {
    fun.log_date(socket.id, 'Received-chat:', socket.id, state.clients[socket.id].name, message);

    // If the message starts with "/" it's a server command
    if(message[0]=='/') {

      // Split it by space
      var s = message.split(' ');

      // Reset to defaults
      if(s[0] == '/reset') reset_game();

      // Boot client by name
      else if(s[0] == '/boot') {

        // Find the client by name and boot them
        for(var id in state.clients) if(state.clients[id].name == s[1]) {
          simulate_lag_out(io, 'chat', [0, 'Booting ' + s[1] + '.']);
          sockets[id].emit('yabooted');
          sockets[id].disconnect(true);
        }

      }

      // Set a variable
      else if(s[0] == '/set') {

        // If we can set it
        if(s[1] in state && !state_keys_no_set.includes(s[1]) && s.length==3) {
        
          // Update
          state[s[1]] = parseFloat(s[2]);

          // Remember for next time
          state_defaults[s[1]] = state[s[1]];

          // Send the state to everyone
          for(var id in sockets) send_state(id);
        }

        // Send the current settings.
        s = 'OPTIONS:';
        for(var key in state) if(!state_keys_no_set.includes(key)) s = s + '\n' + key + ' ' + state[key];
        simulate_lag_out(socket, 'chat', [socket.id,s]);
      }
    } // end of "message starts with /"

    // Send a normal chat
    else simulate_lag_out(io, 'chat', [socket.id,html_encode(message)]);
  }
  socket.on('chat', function(data) {simulate_lag_in(on_chat, data)});

  // handle a single full packet update [n, m, packet]
  function on_u(data) {
    fun.log_date(socket.id, 'Received_u', data[0], data[1]);
    
    // If the alien index is -1, it's a player
    if(data[1] < 0) state.players[data[0]] = data[2];

    // Otherwise it's an alien
    else state.aliens[data[0]][data[1]] = data[2];

    // Broadcast it to everyone else, but not the sender. Only possible with complete ownership by sender.
    for (id in state.clients) { if(id != socket.id) {
      fun.log_date('  Relaying to', id);
      simulate_lag_out(sockets[id], 'u', data);
    }}
  }
  socket.on('u', function(data) {simulate_lag_in(on_u, data)});

  // handle many updates
  function on_fu(data) {
    fun.log_date(socket.id, 'Received_fu', data[0], 'with', data.length, 'elements');
    
    // This is a list containing the player packet and all of that
    // player's alien packets. 
    // 
    // Elements
    //   0 : Player index
    //   1 : Player packet
    //   2+: Alien packets
    
    // Update the state variable for newcomers
    var n = data[0];            // Player index
    state.players[n] = data[1]; // Player packet
    
    // The alien packets on an fu are minipackets
    var object, a;
    for(var m=2; m<data.length; m++) {
      a = state.aliens[n][m-2];
      if(a) {
        object = fun.alien_minipacket_to_object(data[m]);
        
        // If it's enabled, it will have coordinates
        if(object.enabled) {
          a.x = object.x;
          a.y = object.y;
          a.enabled = true;
        }
        else a.enabled = false;
      }
    }

    // Broadcast it to everyone else, but not the sender. Only possible with complete ownership by sender.
    for (id in state.clients) { if(id != socket.id) {
      fun.log_date('  Relaying to', id);
      simulate_lag_out(sockets[id], 'fu', data);
    }}
  }
  socket.on('fu', function(data) {simulate_lag_in(on_fu, data)});


  // Client requests a pause or unpause.
  function on_playing(playing) {
    fun.log_date(socket.id, 'Received_playing', playing);

    // Set the state
    state.playing = playing;

    // If this is a pause, note the time
    if(state.playing) t_last_item += Date.now() - t_pause;
    else              t_pause = Date.now();

    // Broadcast to everyone, including sender, to stay synced in the presence
    // of delays.
    simulate_lag_out(io, 'playing', playing);
  }
  socket.on('playing', function(data) {simulate_lag_in(on_playing, data)});

  // When one or more aliens are hit. Packets are [[n,m,damage], [n,m,damage], ...]
  function on_ah(data) {
    fun.log_date(socket.id, 'Received_ah', data.length);

    // Relay it to everyone else
    for (id in state.clients) { if(id != socket.id) {
      fun.log_date('  Relaying to', id);
      simulate_lag_out(sockets[id], 'ah', data);
    }}
  }
  socket.on('ah', function(data) {simulate_lag_in(on_ah, data)});

  // Kick health [health.index, r]
  function on_kick_health(data) {
    fun.log_date(socket.id, 'Received_kick_health', data);

    // Relay it to everyone else
    for (id in state.clients) { if(id != socket.id) {
      fun.log_date('  Relaying to', id);
      simulate_lag_out(sockets[id], 'kick_health', data);
    }}
  }
  socket.on('kick_health', function(data) {simulate_lag_in(on_kick_health, data)});

  // Handle a single kill. Incoming data is [player_index, alien_index, death_count, d, rd]
  //                                         0,            1,           2,         , 3, 4]
  function handle_single_kill(data) {
    fun.log_date(socket.id, 'single_kill', data);

    // We always decay the current kill rate before adding to it
    state.kill_rate *= fun.fader_smooth(state.t_last_kill, state.t_kill_rate_lifetime);

    // Actually kill it, but only if it exists, 
    // and it's not a duplicate kill
    var n = data[0];
    var m = data[1];

    // If this alien exists (it had better!)
    if(state.aliens[n] && state.aliens[n][m]) {

      // Parse the existing packet
      var a = fun.full_packet_to_object(state.aliens[n][m]);

      // If this is a new death
      if(a.death_count < data[2]) {
        
        // Perform the actual kill and overwrite the existing packet.
        a.death_count      = data[2]; // Set the death_count
        a.enabled          = false;   // disable
        state.aliens[n][m] = fun.object_to_full_packet(a);

        // New rate = 1 + (faded previous kill rate)
        state.kill_rate++;

        // Store the SERVER time of this kill
        state.t_last_kill = Date.now();

        // Update the score
        state.score = state.score + state.kill_rate;

      } // Otherwise it's dead already, so we don't do anything. The previous kill packet will 
        // have updated everyone else.

    } // End of alien exists
    
    return data;
  }
  // Handle many kill packets
  function on_k(data) {

    // Loop over all supplied packets, updating the state
    for(var i=0; i<data.length; i++) handle_single_kill(data[i]);

    // Prepend the score [0] and multiplier [1]
    data.splice(0, 0, state.kill_rate);
    data.splice(0, 0, state.score);

    // Emit to everyone
    fun.log_date(socket.id, '  Relaying', data[0], data[1]);
    simulate_lag_out(io, 'k', data);
  }
  socket.on('k', function(data) {simulate_lag_in(on_k, data)});
  


  // Player hit. data = [player_index, packet, damage, dxi, dyi]
  function on_ph(data) {
    fun.log_date(socket.id, 'Received_ph', data[0], data[2], data[3], data[4]);

    // Update the player packet
    state.players[data[0]] = data[1];

    // Relay it to everyone else
    for (id in state.clients) { if(id != socket.id) {
      fun.log_date('  Relaying to', id);
      simulate_lag_out(sockets[id], 'ph', data);
    }}
  }
  socket.on('ph', function(data) {simulate_lag_in(on_ph, data)});


  // Player dies. data = [player_index, packet, stats, chunks_coordinates]
  function on_pd(data) {

    // Get the player index
    var n = data[0];
    fun.log_date(socket.id, 'Received_pd', n);

    // Update the player packet, which includes the enabled flag
    state.players[n] = data[1];

    // Figure out who's still alive    
    var active_player_indices = [];
    for(var j=0; j<state.players.length; j++) 
      if(fun.full_packet_to_object(state.players[j]).enabled) 
        active_player_indices.push(j);  

    // The aliens now all choose one remaining player
    if(active_player_indices.length) var new_target_index = fun.random_array_element(active_player_indices);
    else                             var new_target_index = -1;

    // Relay it to everyone else
    data.push(new_target_index);
    simulate_lag_out(io, 'pd', data);
  }
  socket.on('pd', function(data) {simulate_lag_in(on_pd, data)});


  // Query for item take [taker.index, item.index, taker.other_data] 
  // other_data might be, e.g., health so the others know whether to kick it or take it.
  function on_take(data) {
    fun.log_date('Received_take, relaying', data);

    // This goes to everyone, so it will disable the item for everyone else before
    // they can take it.
    simulate_lag_out(io, 'take', data);
  }
  socket.on('take', function(data) {simulate_lag_in(on_take, data)});

  // Player says something. data = [player_index, key, interrupt]
  function on_say(data) {
    fun.log_date('Received_say', data);
    
    // Relay it to everyone else
    for (id in state.clients) { if(id != socket.id) {
      fun.log_date('  Relaying to', id);
      simulate_lag_out(sockets[id], 'say', data);
    }}
  }
  socket.on('say', function(data) {simulate_lag_in(on_say, data)});


  // handle the disconnect
  function on_disconnect(data) {
    // Get the id asap
    var id = socket.id;

    // find the client index
    fun.log_date(id, "disconnecting.", data);
    
    // Delete the client data. Socket will delete itself
    if(state.clients) delete state.clients[id]; 

    // If the disconnecting client is playing, have them leave gracefully
    var n = state.enabled_player_ids.indexOf(id)
    if(n >= 0) {

      // Send the death of this player
      // [player_index, packet, stats, chunks_coordinates]
      on_pd([n, state.players[n], null, null]);

      // Set the enabled player id to -1, which means "NEEDED!"
      state.enabled_player_ids[n] = -1;

      // Pick the first enabled player to take over their updates.
      var found_one = false;
      for(var i=0; i<state.enabled_player_ids.length; i++) {
        id = state.enabled_player_ids[i];

        // If this id is not false and is greater than zero, assign it to them
        if(id && id > 0) {
          fun.log_date(id, '  Sending_take_over', n);
          simulate_lag_out(sockets[id],'take_over', n);
          found_one = true;
        }
      } // End of loop over enabled players
      
      // If we didn't find someone, reset the game (doesn't affect client list)
      if(!found_one) {

        // Resets the local state
        reset_game();

        // Send the state to everyone else (observers, presumably)
        fun.log_date('Sending_state to remaining clients', state);
        for(var id in state.clients) send_state(id);
      
      } // End of "didn't find a replacement"
    
    } // End of disconnecting player is active

    // tell the world!
    simulate_lag_out(io, 'clients', state.clients);
  }
  socket.on('disconnect', function(data) {simulate_lag_in(on_disconnect, data)});

}); // end of io


// Start a timer for maintenance / updates
setInterval(function() {

  // Send an item?
  if(state.playing && Date.now()-t_last_item > state.t_item_delay) {
    
    // Assemble the items list
    items = [];
    for(var i=0; i<state.n_health;   i++) items.push('health');
    for(var i=0; i<state.n_sploders; i++) items.push('sploders');
    for(var i=0; i<state.n_barrel;   i++) items.push('barrel');

    // Get a random location
    var x = (Math.random()*0.94 + 0.03)*state.game_width;
    var y = (Math.random()*0.9  + 0.05)*state.game_height;

    // Send a random item
    item = fun.random_array_element(items);
    fun.log_date('Sending_i', [item,x,y]);
    simulate_lag_out(io, 'i', [item,x,y]);

    // Reset clock
    t_last_item = Date.now();
  }
}, 250);



// actually start listening for requests
http.listen(port, function() {
  fun.log_date('listening on port '+String(port));
});
