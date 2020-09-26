/**
 * This file is part of the Wholesale Alien Slaughter distribution.
 * Copyright (c) 2020 Jack Childress (Sankey).
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



// REFERENCE
// Alien.max_v = 0.5+1.3*Math.random(); // 0.5-1.8 (player is 2.0)


// PAINFUL:
// Items should go to the closest player, not the first touching.
// Track the source of damage through chain.
// Aliens sometimes choose a dead player or the wrong player.
//
// FUN:
// Ning Ning wasted ammo
// "Gosh darn it" when you lose the health you just gained.
// Beam-in for items
// "ASSHOLE" stamp for taking health needlessly
// "INCOMPETENT" stamp for missed sploders
// Sploder chain bonus?
// Protect the nuke: can push, can shoot / harm, can repair standing next to it.
// Help mechanic?
// Alien's carrying barrels. Barrel kill count.
// Dead players run barrel deployment.

// NOTES
//
// TCP headers are up to 40 bytes (5 64-bit floats)

///////////////////////////////
// Constants
///////////////////////////////

let game_modes = {
  
  'relaxing': {
    'aliens_per_player': 77,
    't_item_delay': 8000,
    't_respawn_halflife' : 80e3,
    'rounds_player_harm_scale': 0,
    'n_health': 10,
    'n_sploders': 10,
    'n_barrel': 0,
  },

  'teamwork': {
    'aliens_per_player': 50,      // Fewer aliens
    't_item_delay': 8000,
    't_respawn_halflife' : 120e3, // Slower ramp-up.
    'rounds_player_harm_scale': 0,
    'n_health': 10,
    'n_sploders': 10,
    'n_barrel': 0,
    'mode_teamwork': 0.875, // damage scale for own aliens = 1-state.mode_teamwork
  },
  
  'tight': {
    'game_width': 1280,
    'game_height': 720,
    'aliens_per_player': 20,
    't_item_delay': 7000,
    'n_health': 7,
    'n_sploders': 7,
    'n_barrel': 0,
  },

  'sploders': {
    'game_width': 1280,
    'game_height': 720,
    'aliens_per_player': 20,
    'splodalien_probability': 0.50,
    't_item_delay': 5000,
    'n_health':   7,
    'n_sploders': 0,
    'n_barrel': 0,
  },

  'test': {
    'game_width': 1280,
    'game_height': 1280,
    'aliens_per_player': 1,
    'splodalien_probability': 0.5,
    't_update_delay': 3000,
    't_item_delay': 4000,
    'n_health':   2,
    'n_sploders': 1,
    'n_barrel': 2,
  },
  
}

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
  'max_gun_push':              10, // Saturation distance when pushing with a gun
  
  'rounds_sploder_damage_scale': 0.5,
  'rounds_sploder_radius':        30,
  'rounds_player_harm_scale':      0,  // Fractional scale for how much your ammo can hurt you.
  'chunk_maximum_distance':     2000, // Ceiling on chunk distance.

  'damage_multiplier' :     1,    // How much to scale up the damage.

  'score' :                 0,    // Points
  'kill_rate' :             0,    // Kills per second
  'kill_rate_scale' :     100,    // Overall scale.
  't_last_kill' :           0,    // Elapsed time since last kill
  't_kill_rate_lifetime' : 3000,  // Filter time constant on the kill rate

  't_update_delay' :        1000,  // How long to wait afert the last update to send the next
  't_respawn_delay' :       1500,  // How long to wait (at the beginning of the game) for aliens to respawn
  't_respawn_halflife' :    50e3,  // How long the t_respawn_delay decays
  't_player_hit_delay' :    300,   // How long a delay between player hits
  
  't_simulated_lag' :          0,  // How long to wait before processing packets
  't_sync_ping_delay' :     1000,  // How long to wait in between sync pings.
  't_error_correction' :     700,  // How long to smooth out discrepancies
  
  't_item_delay' :          10000, // How long between items appearing
  'n_health':                   2, // How many healths exist

  'mode_teamwork':              0, // Whether we're doing the "teamwork" game

  'role_names' :            ['Observer', 'Blue', 'Red', 'Yellow', 'Violet'],
  
  'enabled_player_ids' :    [false, false, false, false], // id's of players in game
  'players' :               [false, false, false, false], // One player packet per player_color
  'aliens' :                [false, false, false, false], // One list of alien packets per player_color
}

// Character types
let player_colors      = [0x99BBFF, 0xFFAAAA, 0xffE84B, 0xD65CFF]; // One color per player
let TINT_BURN          = 0x110700;
let TINT_PLAYER_SAUCE  = 0xFF4444;
let TINT_ALIEN_SAUCE   = 0xFFFFFF;
let TINT_ALIEN_SPLODER = 0xFFAA00;
let ALIEN_NORMAL  = 1;
let ALIEN_SPLODER = 2; 

// CPU savers
let COS30 = Math.sqrt(3)*0.5;
let SIN30 = 0.5;
let COS60 = 0.5;
let SIN60 = COS30;

/////////////////////////////////
// SETTINGS AND STATE
/////////////////////////////////

let state              = {}  // Everything about the current game state, sent by the server initially.
let players            = []; // list of player sprites
let aliens             = []; // list of lists of alien sprites
let all_things         = []; // list of all non-decoration objects.
let hit_thing_packets  = []; // List of pending alien hit packets
let alien_kill_packets = []; // List of pending alien kill packets
let alive_player_indices = []; // Current list of alive player_index's, updated each frame.
let participant_indices  = []; // List of player indices at start of game.
let cookie_expire_days = 28; // Fitting number of days for a game such as this.
let t_last_update      = 0;
let t0_game            = 0; // Time of game start
let t_next_respawn     = 0; // Time of last respawn
let t_paused           = 0; // How long we've paused for (for determining alien respawn rate)
let stunned            = 0; // How stunned we are (affects visuals)
let t_blinder          = 800; // How long the blinder lasts
let blinder_saturation = 0.7;
let t_last_kill        = 0;
let n_enabled          = 1; // Number of enabled players.

// Gui element shortcuts
let html_loader       = document.getElementById('loader');
let html_settings     = document.getElementById('settings');
let html_volume       = document.getElementById('volume');
let html_volume_music = document.getElementById('volume_music');
let html_gameboard    = document.getElementById('gameboard');
let html_score        = document.getElementById('score');
let html_multiplier   = document.getElementById('multiplier');
let html_stats        = document.getElementById('stats')

////////////////////////////////
// Client Server Stuff        //
////////////////////////////////
var me               = io();  // Socket for communication & other stuff
me.player_index      = -1;    // Default value for player index (observer)
let clients          = {};    // List of client data from server.
me.ready_for_packets = false;
me.ready_for_play    = false;
me.other_responsibilities = [];
me.is_active = function() {return (me.player_index >= 0);}


//////////////////////////
// Resource lists       //
//////////////////////////

jukebox_list = [
  //       0     1     2     3     4     5     6     7
  ['0', [ '0', '00', '12', '12', '12', '45', '56', '56']],
  ['1', ['11', '11', '12', '12', '12', '45', '56', '56']],
  ['2', ['22', '22', '22', '22', '22', '45', '56', '56']],
  ['3', ['33', '33', '33', '33', '33', '45', '56', '56']],
  ['4', ['44', '44', '44', '44', '44', '45', '56', '56']],
  ['5', ['55', '55', '55', '55', '55', '55', '56', '56']],
  ['6', ['66', '66', '66', '66', '66', '66', '66', '56']],
  ['7', ['77', '77', '77', '77', '77', '77', '77', '77']],
];

jukebox_list_birthday = [
  ['0', ['0',  '01', '01', '01']],
  ['1', ['0', '11', '11', '11']],
  ['2', ['0', '11', '22', '22']],
  ['3', ['0', '22', '22', '33']],
]

sound_list = {
  
  // Simple sounds 
  'shoot'   : ['sounds/shoot.ogg',    0.1],
  'bam'     : ['sounds/bam.ogg',      0.5],
  'clip1'   : ['sounds/clip.ogg',     0.5],
  'health'  : ['sounds/health.ogg',   0.5],
  'beamdown': ['sounds/beamdown.ogg', 0.5],

  // Multi-take groups
  'splat' : { 
    'splat1' : ['sounds/splat1.ogg', 0.15],
    'splat2' : ['sounds/splat2.ogg', 0.15],
    'splat3' : ['sounds/splat3.ogg', 0.15],
    'splat4' : ['sounds/splat4.ogg', 0.15],
  },

  'pop' : {
    'pop1' : ['sounds/pop1.mp3', 0.35],
    'pop2' : ['sounds/pop2.mp3', 0.35],
    'pop3' : ['sounds/pop3.mp3', 0.35],
    'pop4' : ['sounds/pop4.mp3', 0.35],
  },
  
  'drip' : {
    'drip1' : ['sounds/drip1.mp3', 0.15],
    'drip2' : ['sounds/drip2.mp3', 0.15],
    'drip3' : ['sounds/drip3.mp3', 0.15],
    'drip4' : ['sounds/drip4.mp3', 0.15],
  },

  'alien' : {
    'alien1' : ['sounds/alien1.ogg', 0.25],
    'alien2' : ['sounds/alien2.ogg', 0.25],
    'alien3' : ['sounds/alien3.ogg', 0.25],
    'alien4' : ['sounds/alien4.ogg', 0.25],
    'alien5' : ['sounds/alien5.ogg', 0.25],
    'alien6' : ['sounds/alien6.ogg', 0.25],
    'alien7' : ['sounds/alien7.ogg', 0.25],
    'alien8' : ['sounds/alien8.ogg', 0.25],
    'alien9' : ['sounds/alien9.ogg', 0.25],
  },

  'kick_health' : {
    'kick_health1' : ['sounds/kick_health1.ogg', 0.3],
  },

  // Voice Sets
  'jack' : {

    'wasteful': {
      'imadick1' : ['sounds/player/imadick1.ogg',1],
      'imadick2' : ['sounds/player/imadick2.ogg',1],
      'isuck1'   : ['sounds/player/isuck1.ogg',  1],
    },

    'kick_health': {
      'whoops1'  : ['sounds/player/whoops1.ogg', 1],
      'whoops2'  : ['sounds/player/whoops2.ogg', 1],
      'oops2'    : ['sounds/player/oops2.ogg', 1],
      'dontneed' : ['sounds/player/dontneed.ogg',0.7],
    },

    'got_ammo': {
      'heoyeo'  : ['sounds/player/heoyeo.ogg', 1],
    },

    'near_sploder': {
      'nonononono': ['sounds/player/nonononono.ogg', 1],
      'woawoa'    : ['sounds/player/woawoa.ogg',     1],
      'woabecool1': ['sounds/player/woabecool1.ogg', 1],
      'no1'       : ['sounds/player/no1.ogg', 1],
      'no2'       : ['sounds/player/no2.ogg', 1],
      'no3'       : ['sounds/player/no3.ogg', 1],
      'no4'       : ['sounds/player/no4.ogg', 1],
      'no5'       : ['sounds/player/no5.ogg', 1],
      'no6'       : ['sounds/player/no6.ogg', 1],
    },

    'miss': {
      'isuck3'      : ['sounds/player/isuck3.ogg', 1],
      'isuck4'      : ['sounds/player/isuck4.ogg', 1],
      'isuckisuck'  : ['sounds/player/isuckisuck.ogg', 1],
      'fail'        : ['sounds/player/fail.ogg', 1],
      'whatafailure': ['sounds/player/whatafailure.ogg', 1],
    },

    'missepic' : {
      'dadissues1'  : ['sounds/player/dadissues1.ogg', 1],
      'dadissues2'  : ['sounds/player/dadissues2.ogg', 1],
     },

    'kill_spree': {
      'wooo'   : ['sounds/player/wooo.ogg', 1],
      'wow'    : ['sounds/player/wow.ogg',  1],
      'harvest': ['sounds/player/harvest.ogg', 1],
    },

    'diediedie' : {
      'nonononono' : ['sounds/player/nonononono.ogg', 1],
    },

    'pain1' : {
      'pain_a1' : ['sounds/player/pain_a1.ogg', 1],
      'pain_a2' : ['sounds/player/pain_a2.ogg', 1],
      'pain_a3' : ['sounds/player/pain_a3.ogg', 1],
    },

    'pain2' : {
      'pain_b1' : ['sounds/player/pain_b1.ogg', 1],
      'pain_b2' : ['sounds/player/pain_b2.ogg', 1],
    },

    'pain3' : {
      'pain_c1' : ['sounds/player/pain_c1.ogg', 1],
      'pain_c2' : ['sounds/player/pain_c2.ogg', 1],
    },
  },
};

// Add the jukebox entries
for(var n=0; n<jukebox_list.length; n++) {

  // Load the first element
  sound_list[jukebox_list[n][0]] = ['music/'+jukebox_list[n][0]+'.ogg', 1.0];

  // Loop over the remaining
  for(var m=0; m<jukebox_list[n][1].length; m++)
    sound_list[jukebox_list[n][1][m]] = ['music/'+jukebox_list[n][1][m]+'.ogg', 1.0];

}
  

// Master list of all images.
image_root_path = 'images/';
image_list = [
  
  'soldier/soldier_top1.png',
  'soldier/soldier_top2.png',
  'soldier/soldier_top3.png',

  'soldier/soldier_bottom1.png',
  'soldier/soldier_bottom2.png',
  'soldier/soldier_bottom3.png',
  'soldier/droplet.png',
  'soldier/chunk_foot1.png',
  'soldier/chunk_foot2.png',
  'soldier/chunk_torso.png',
  'soldier/chunk_arm1.png',
  'soldier/chunk_arm2.png',
  'soldier/chunk_shoulder1.png',
  'soldier/chunk_shoulder2.png',
  'soldier/chunk_head.png',
  
  'weapons/rifle.png',
  'weapons/rifle_flash.png',
  'weapons/rifle_splat.png',

  'aliens/walk1.png',
  'aliens/walk2.png',
  'aliens/walk3.png',
  'aliens/chunk_torso.png',
  'aliens/chunk_foot1.png',
  'aliens/chunk_foot2.png',
  'aliens/chunk_arm1.png',
  'aliens/chunk_arm2.png',
  'aliens/chunk_head.png',
  'aliens/droplet.png',
  'aliens/splat.png',
  
  'items/health.png',
  'items/health_chunk1.png',
  'items/health_chunk2.png',
  'items/health_chunk3.png',
  'items/health_chunk4.png',
  'items/health_chunk5.png',
  'items/health_chunk6.png',
  'items/health_chunk7.png',
  'items/sploders.png',
  'items/barrel.png',

  'flash.png',
  'empty.png',
  'tunnel_vision.png',
]



///////////////////////////////
// FUNCTIONS                 //
///////////////////////////////
function get_angle(dx, dy) {
  
  // Figure out the angle, avoiding a NaN
  if(Math.abs(dy) > 1e-12) {
    var angle = Math.atan(-dx/dy);
    if(dy>0) angle += Math.PI;
  }
  // Otherwise, if dy==0, we have an easier calculation
  else if (dx > 0) var angle =  Math.PI*0.5;
  else             var angle = -Math.PI*0.5;

  return angle;
}

// Gets the texture associated with the path or raises an error.
function get_texture(path) {
    if(resources[path]) return resources[path].texture;
    else throw 'No resource for ', path;
}

// Increment the blinder safely
function add_to_blinder(scale, threshold) {
  if(isNaN(threshold)) threshold = 0;

  // Increment the blinder in a way that saturates at 1.
  var x = (scale-threshold)*2;
  log('blinder x =',x); 
  if(x < 0) x = 0;
  blinder.alpha += (blinder_saturation-blinder.alpha)*(1-1/(1+x*x)); // Only really big ones really blind (x*x)
}

////////////////////////////////////
// PIXI SETUP                     //
////////////////////////////////////



// By default, use WebGL, fallback on canvas
let type = "WebGL"
if(!PIXI.utils.isWebGLSupported()) type = "canvas";

// Create a Pixi Application
let app = new PIXI.Application({ 
    antialias:   false, // default: false
    transparent: false, // default: false
    resolution: 1       // default: 1
  });

//Add the canvas that Pixi automatically created for you to the HTML document
html_gameboard.appendChild(app.view);

//Aliases
let Application = PIXI.Application,
    loader      = PIXI.Loader.shared,
    resources   = PIXI.Loader.shared.resources,
    Sprite      = PIXI.Sprite,
    stage       = app.stage;
    renderer    = app.renderer;

// Set up the renderer
renderer.backgroundColor     = 0x000000;
renderer.autoDensity         = true;
renderer.view.style.position = "absolute";
renderer.view.style.display  = "block";

// Set up loading progress indicator, which happens pre PIXI start
loader.on("progress", function(loader, resource) {
  log('progress: loaded', resource.url, loader.progress, '%');

  html_loader.innerHTML = '<h1>Loading: ' + loader.progress.toFixed(0) + '%</h1><br>' + resource.url;

});

// Load up the images and then the characters
var image_list_full = [];
for(var n=0; n<image_list.length; n++) image_list_full.push(image_root_path+image_list[n]);

loader.add(image_list_full).load(function() {
  
  // Create an empty texture
  texture_empty = get_texture('images/empty.png');

  // Connect to server and get game state
  connect_to_server();
});




////////////////////////////
// SOUNDS                 //
////////////////////////////

// Class for looping the music / choosing loop chunks
class Jukebox {

  // playlist has structure [['0', ['00','01','02']], ['1', ['10','11','12']],...]
  constructor(playlist) {

    this.playlist = playlist;
    this.reset();
  }

  // Resets to default state.
  reset() {
    this.level            = 0;     // which sub-playlist we're on
    this.is_playing       = false; // whether it's playing
    this.is_transition    = false;
    this.current_sound    = null; // instance of Sound that's currently playing
    this.current_id       = null; // ID of the currently playing sound
    this.starting_score   = 0;
    this.force_next_level = 0;
  }

  // Calculate the level based on accumulated score change
  get_next_level() {
    
    // Options for juke bumps

    // First by score
    var option_score = this.playlist.length * (state.score-this.starting_score)*0.01;

    // By current multiplier
    var option_kill_rate = this.playlist.length * state.kill_rate*fader_smooth(t_last_kill, state.t_kill_rate_lifetime)*0.05 / (n_enabled ? n_enabled : 1);

    // Decision
    var decision = Math.floor(Math.min(
      
      // Maximum index allowed
      this.playlist.length-1,

      // Maximum of these possibilities
      Math.max(

        // First: score accumulated during loop.
        option_score,

        // Second: current multiplier high
        option_kill_rate,

        // Forced next level, set by transition
        this.force_next_level,

        // Maximum demotion of 25%
        this.level-0.25*this.playlist.length,
      )
    ));

    log('jukebox.get_next_level, s:', Math.floor(option_score), 'm:', Math.floor(option_kill_rate), 'f:', this.force_next_level, '=', decision);

    return decision;
  }

  // Start the loop!
  play_next() {
    
    // Remember we are playing now.
    this.is_playing = true;

    // first figure out the new level based on the accumulated score and multiplier etc
    var next_level = this.get_next_level();

    // If we're not supposed to play a transition, get the key for the current level loop.
    // Otherwise we're supposed to play a transition
    if(!this.is_transition) {

      // Set the level and get the sound key for this loop
      this.level = next_level;
      var key = this.playlist[this.level][0];
      this.force_next_level = 0;
    }

    // We are supposed to pick a transition and new level
    else {

      // Get the key for the transition from the current to next level, then update the level
      var key = this.playlist[this.level][1][next_level];

      // If we're making an upgrade transition, make sure we hit it for at least one round.
      if(this.level < next_level) this.force_next_level = next_level;
      this.level = next_level;      
    }

    // Reset the score for this loop
    this.starting_score = state.score;

    log('jukebox.play_next', key, this.is_transition);

    // Store the sound instance for later use
    this.current_sound = sounds.sounds[key];

    // Play it.
    this.current_id = this.current_sound.play();
    
    // queue the next segment
    this.current_sound.howl.once('end', function() { 
      
      // If it's in transition, we switch to root. If it's root, we switch to transition
      jukebox.is_transition = !jukebox.is_transition;
      jukebox.play_next();
    });
  }

  set_pause(pause) {
    log('jukebox.set_pause', pause, 'currently disabled')
    /*if(this.is_playing) {
      if(pause) this.current_sound.howl.pause();
      else      this.current_sound.howl.play();
    }*/
  }

  // Stop / reset
  stop() {
    if(this.is_playing) {

      // Remove the "on end" event
      this.current_sound.howl._onend.length = 0;

      // Stop the current sond
      this.current_sound.howl.stop();
      
      // Reset.
      this.reset();
    }
  }

  set_volume(v) {
    // loop over all the sounds in the playlist and set the volume.
    for(var i=0; i<this.playlist.length; i++) {
      // Set the root volume.
      this.sounds.sounds[this.playlist[i][0]].howl.volume(v);

      // Set the transitions volume.
      for(var j=0; j<this.playlist[i][1].length; j++) {
        var name = this.playlist[i][1][j];
        this.sounds.sounds[name].howl.volume(v);
      }
    }
  }
}

class Sound {

  // Constructor just registers the sound and records the time
  constructor(path, volume) {
    
    // Create the howl
    this.howl = new Howl({
      src:    [path], 
      volume: volume
    });
    
    // Internal settings
    this.path = path;
  }

  // Play the sound immediately
  play(x,y,rate) {

    // Default to center pan
    if(isNaN(x) || isNaN(y)) {
      x = 0.5*state.game_width;
      y = 0.5*state.game_height;
    }
    
    // Update the sound coordinates for this sound id
    var xn = 2*(x-0.5*state.game_width )/state.game_width;
    var yn = 2*(y-0.5*state.game_height)/state.game_height;
    xn = Math.max(-1,xn); xn = Math.min(1,xn);
    yn = Math.max(-1,yn); yn = Math.min(1,yn);
    var p = 4*xn;
    
    // Start play and adjust for that instance
    var id = this.howl.play();
    //this.howl.pos(xn, 0.5*yn, 1, id); // Requires a model to be set.
    this.howl.stereo(0.7*xn, id); //p/Math.sqrt(1+p*p),  id);

    // Adjust the playback speed
    if(rate) this.howl.rate(rate, id);

    // return the id
    return id;
  }
}

// Library of all sounds with progress and after_loaded() function
class SoundLibrary {

  // Constructor sets up internal data structures
  // Paths should be an object with sound options, e.g.
  // {'key':['/path/to/sound',volume], 'key2': ...}
  constructor(specs) {
    log('SoundLibrary constructor()', specs);

    // keep an eye on specs
    this.specs  = specs;
    
    // Object to remember all sounds by keys
    this.sounds = {};

    // Count the number of sounds
    this.length = 0;
    this._count(specs); 
    
    // Loop over all the specs, loading one sound per path
    this.n=0;
    this._load(specs);
  }

  // Function to recursively count the sounds in a group
  _count(object) {

    // Loop over the keys
    for(var key in object) {

      // Normal sound
      if(Array.isArray(object[key])) this.length++;
      
      // Object
      else this._count(object[key]);
    }
  }

  // Function to recursively load the sounds in a group
  _load(object) {

    // Loop over the keys
    for(var key in object) {

      // Normal sound
      if(Array.isArray(object[key])) {
        
        // Counter for progress bar.
        this.n++;
        
        // Make the new Howl to play this sound
        this.sounds[key] = new Sound(object[key][0], object[key][1]);
      
        // What to do when it loads
        this.sounds[key].howl.once('load', this._onprogress(key, object[key], Math.round(100*this.n/this.length)));
      }

      // Object. Run the load recursively.
      else this._load(object[key]);
    }
  }

  // Function called when a Howl has finished loading
  _onprogress(key, specs, percent) {
    log('SoundLibrary loaded', key, specs, percent);

    // If we hit 100%, load the volume slider
    if(percent == 100) {
    
      // Give the jukebox a handle on this so it can set the volumes.
      jukebox.sounds = this;

      // Load the sound settings.
      html_volume      .value = get_cookie_value('volume');
      html_volume_music.value = get_cookie_value('volume_music');

      // Send em.
      event_volume_onchange();
    }
  } // End of onprogress()

  // Play a sound by spec path. Returns [key, id]
  play(path, x, y, rate) {

    // Split the key by '/'
    var keys = path.split('/');
    
    // loop and get the spec
    var spec = this.specs;
    for(var n=0; n<keys.length; n++) spec = spec[keys[n]];

    // If spec is an array, e.g., ['spec/path/to/soundname',1], just use the last key for the name.
    if(Array.isArray(spec)) var key = keys[n-1];
    
    // Otherwise we need to pick a random key
    else var key = random_array_element(Object.keys(spec));

    // Play it and return [key,id]
    var id = this.sounds[key].play(x,y,rate);
    return [key,id];
  }

  // Old method; plays a random selection, returning [key, id]
  play_random(keys, x, y, rate) {

    var key = random_array_element(keys);
    var id  = this.sounds[key].play(x,y,rate); 
    return [key, id];
  }

  mute() {
    Howler.volume(0);
  }
  unmute() {
    event_volume_onchange();
  }
  set_mute(mute) {
    if(mute) this.mute();
    else     this.unmute();
  }

}

// Load all the sounds with a progress bar.
let jukebox = new Jukebox(jukebox_list);
let sounds  = new SoundLibrary(sound_list);
      







/////////////////////////////
// CHARACTERS              //
/////////////////////////////

// Thing that flashes an image
// Object to provide visuals of a bullet that was fired
class Flash {

  constructor(image_path, t_flash) {
    if(!t_flash) t_flash=100;

    // Create a container, just to behave like other objects.
    this.container = new PIXI.Container();
    
    // Sprite
    this.sprite = new PIXI.Sprite(resources[image_root_path+image_path].texture);
    
    // Center the image
    this.sprite.anchor.set(0.5, 0.5);
    
    // Add it to the container
    this.container.addChild(this.sprite);

    // Add the container to the stage and set up its geometry
    stage.addChild(this.container);
    
    // Set the sprite geometry
    this.set_sprite_xysr(0,0,1,0);

    // Initially not flashing.
    this.container.alpha = 0;

    // Timing for animations
    this.t0 = 0;
    this.t_flash = t_flash;   // How long the flash persists
  }

  // Sends the locally-set values of x, y, r and s to 
  set_sprite_xysr(x,y,s,r) {
    this.x = x;
    this.y = y;
    this.s = s;
    this.r = r;
    this.container.x = this.x;
    this.container.y = this.y;
    this.container.rotation = this.r;
    this.container.scale.x = this.s;
    this.container.scale.y = this.s;
  }

  // Starts the animation and plays a random sound.
  start(x, y, s, r, flip_x, flip_y, tint) {
    if(!s) s = 1;

    // Set the geometry
    this.set_sprite_xysr(x,y,s,r);

    // Flip image if we're supposed to
    if(flip_x) this.container.scale.x *= -1;
    if(flip_y) this.container.scale.y *= -1;
    if(tint)   this.sprite.tint = tint;

    // Record the time
    this.t0 = Date.now();
    
    // Light it up!
    this.container.alpha = 1;
  }

  // Animate
  animate(delta) {

    // Make the flash fade
    this.container.alpha = fader_smooth(this.t0, this.t_flash);  
  }  

} // End of Flash class

// List of flashes that we can cycle through
class Flashes {

  constructor(N, image_path, t_flash) {

    // List of Flash objects
    this.flashes = [];
    for(var n=0; n<N; n++) this.flashes.push(new Flash(image_path, t_flash));
    this.length = N;
    
    // Our current index
    this.n = 0;
  }

  // Animate all flashes.
  animate(delta) {
    for(var n=0; n<this.flashes.length; n++) 
      this.flashes[n].animate(delta);
  }

  // Just starts the next flash and increments safely
  start(x, y, s, r, flip_x, flip_y, tint) {  
    
    // Increment first, in case start() causes other start()'s
    this.n++; if(this.n >= this.flashes.length) this.n=0;

    // Start this one
    this.flashes[this.n].start(x, y, s, r, flip_x, flip_y, tint);
  }
}


// Single explosion
class Explosion {

  constructor() {

    // Physical location and orientation
    this.source = null;
    this.dummy_source = new Thing([['empty.png']], '', 1, 0);
    this.radius = 100;
    
    // Create a container for the stack of sprites
    this.container = new PIXI.Container();
    
    // Sprite
    this.sprite = new PIXI.Sprite(resources[image_root_path+'flash.png'].texture);
    
    // Center the image
    this.sprite.anchor.set(0.5, 0.5);
    
    // Add it to the container
    this.container.addChild(this.sprite);

    // Add the container to the stage and set up its geometry
    stage.addChild(this.container);
    
    // Set the sprite geometry
    this.set_sprite_xysr(0,0,1,0);

    // Initially not flashing.
    this.container.alpha = 0;

    // Timing for animations
    this.t0 = 0;
    this.t_flash = 100;   // How long the flash persists
  }

  // Sends the locally-set values of x, y, r and s to 
  set_sprite_xysr(x,y,s,r) {
    this.x = x;
    this.y = y;
    this.s = s;
    this.r = r;
    this.container.x = this.x;
    this.container.y = this.y;
    this.container.rotation = this.r;
    this.container.scale.x = this.s;
    this.container.scale.y = this.s;
  }

  // Detonate using the internal dummy source at the specified location with the specified radius
  detonate(x, y, radius, harm_aliens, player_harm_scale, damage_scale) {

    // Set the dummy source's internals
    this.dummy_source.x = x;
    this.dummy_source.y = y;
    this.dummy_source.container.x = x;
    this.dummy_source.container.y = y;
    this.dummy_source.radius = radius;
    this.max_v = 12*state.scale_radius*state.scale_sprite/this.radius;
    this.detonate_source(this.dummy_source, harm_aliens, player_harm_scale, damage_scale);
  }

  // Starts the animation and plays the boom sound at the coordinates of the supplied source.
  // Source can be a character, or any object having x, y, radius, container, and max_v, defined.
  // harm_aliens is true if I caused the detonation; determines whether the aliens get hurt.
  detonate_source(source, harm_aliens, player_harm_scale, damage_scale) {
    
    this.source = source;

    // Set the internal variables
    this.radius = source.radius;

    // Transfer these to the image
    this.set_sprite_xysr(source.x, source.y, source.radius*0.03, Math.random()*Math.PI*2);

    // Record the time
    this.t0 = Date.now();
    
    // Light it up!
    this.container.alpha = 1;

    // Blind if too bright
    add_to_blinder(this.s, 0.7);

    // Play the noise
    this.sound_id = sounds.play('bam', this.x,this.y,1.5/this.s)[1];

    // Any explosion should only damage our player locally. Other players will tell us when they're damaged
    this.damage(players[me.player_index], true, player_harm_scale*damage_scale); 

    // Loop over *all* aliens, assigning damage if I caused the detonation (otherwise it just pushes).
    for(var n=0; n<players.length; n++) 
      for(var m=0; m<aliens[n].length; m++) 
        this.damage(aliens[n][m], harm_aliens, damage_scale);
    
    // Loop over items that can take damage
    for(var i=0; i<items.items['barrel'].length; i++)
      this.damage(items.items['barrel'][i], harm_aliens, damage_scale);

    // Loop over all enabled chunks
    for(var n=0; n<chunkgroups_aliens.chunks.length; n++) this.damage(chunkgroups_aliens.chunks[n]);
    for(var n=0; n<chunkgroups_health.chunks.length; n++) this.damage(chunkgroups_health.chunks[n]);

    // Leave a burn mark
    this.sprite.tint = TINT_BURN;
    renderer.render(this.container, floor_texture, false);
    this.sprite.tint = 0xFFFFFF;
  }

  // Explosion damages another Character
  damage(target, allow_damage, damage_scale) {
    
    // Only bother with the calculation if the target is enabled.
    if(!target || target.is_disabled()) return;

    // Explosion radius
    var R  = this.radius*5;
    var RR = R*R;
    
    // Damage any target within a radius
    var dx = this.x - target.x;
    var dy = this.y - target.y;
    var rr = (dx*dx+dy*dy)/RR; // scaled radius

    // If we're within R hit!
    if(rr < 1) {

      // If no damage scale is supplied
      if(isNaN(damage_scale)) damage_scale = 1;

      // Damage 20x at epicenter, zero at R, fairly fast fall-off, just below 1 at R/2
      damage_scale *= (1/(1+7*rr)-0.125)*20;
      
      // Hit em, allowing damage if me, ignoring hit delay, scaled up
      target.get_hit(this.source, allow_damage, true, damage_scale);
    }
  }

  // Animate
  animate(delta) {
    
    // Make the flash disappear
    this.container.alpha = fader_smooth(this.t0, this.t_flash);
  }  
}

// List of explosions that we can cycle through
class Explosions {

  constructor(N) {

    // List of explosions
    this.explosions = [];
    for(var n=0; n<N; n++) this.explosions.push(new Explosion());
    this.length = N;
    
    // Our current index
    this.n = 0;
  }

  // Animate all explosions.
  animate(delta) {
    for(var n=0; n<this.explosions.length; n++) 
      this.explosions[n].animate(delta);
  }

  // Just detonates the current explosion and incremnets safely
  detonate(x,y,radius,harm_aliens,player_harm_scale,damage_scale) {

    // If you put the n++ in the [], subsequent explosions triggered by this one can reach beyond 
    // this.explosions.length-1.
    this.n++; if(this.n >= this.explosions.length) this.n=0;

    // Detonate it.
    this.explosions[this.n].detonate(x,y,radius,harm_aliens,player_harm_scale,damage_scale);
  }

  // Just detonates the current explosion and increments safely
  detonate_source(source,harm_aliens) {  

    // If you put the n++ in the [], subsequent explosions triggered by this one can reach beyond 
    // this.explosions.length-1.
    this.n++; if(this.n >= this.explosions.length) this.n=0;

    // Detonate it.
    this.explosions[this.n].detonate_source(source,harm_aliens);
  }
}


// Object to keep track of / animate chunks
class Chunk {

  constructor(image_path, chunkgroups_sauce, splatter, defer_adding, tint) {
    
    // What we paint (if anything) when we're done. If we paint, we disappear
    if(splatter==true) splatter = this;
    this.splatter = splatter;

    // Default tint
    if(tint == undefined) this.tint = 0xFFFFFF;
    else                  this.tint = tint;

    // A ChunkGroups object for spawning sauce chunks
    this.chunkgroups_sauce = chunkgroups_sauce;

    // Target locations
    this.target_x = 0;
    this.target_y = 0;
    this.target_r = 0;

    // Unscaled starting locations
    this.x0 = 0;
    this.y0 = 0;
    this.r0 = 0;

    // Scale
    this.s = 1;

    // Time of start
    this.t0 = 0;
    this.t_slide = 500;

    // Create a container, just to behave like other objects.
    this.container = new PIXI.Container();
    
    // Sprite
    this.sprite = new PIXI.Sprite(resources[image_root_path+image_path].texture);
    
    // Center the image
    this.sprite.anchor.set(0.5, 0.5);
    
    // Add it to the container
    this.container.addChild(this.sprite);

    // Add the container to the stage and set up its geometry
    if(!defer_adding) stage.addChild(this.container); 
    
    // Set the sprite geometry
    this.set_sprite_xysr(0,0,1,0);

    // Initially not there
    this.container.visible = false; 
  }

  set_disabled(disabled) {if(disabled==undefined) disabled=true; this.container.visible = !disabled;}
  set_enabled (enabled)  {if(enabled ==undefined) enabled =true; this.container.visible = enabled;}
  enable()  {this.set_enabled(true);}
  disable() {this.set_disabled(true);}
  is_enabled()  {return  this.container.visible;}
  is_disabled() {return !this.container.visible;}

  // Sends the locally-set values of x, y, r and s to 
  set_sprite_xysr(x,y,s,r) {
    this.x = x;
    this.y = y;
    this.s = s;
    this.r = r;
    this.container.x = this.x;
    this.container.y = this.y;
    this.container.rotation = this.r;
    this.container.scale.x  = this.s;
    this.container.scale.y  = this.s;
  }

  // Starts the animation with nominal distance d and unit vector cos, sin
  // t_slide is the time of flight. If undefined, it's 250-750 ms.
  // t_scale is an overall scale factor on the tfiming for all time of flights.
  start(d,cos,sin,t_slide,t_scale,tint) {
    
    // Put a ceiling on the distance traveled
    var max = state.chunk_maximum_distance;
    d = max*(1-1/(1+d/max));

    // Remember these for the sauce...
    this.d   = d;
    this.cos = cos;
    this.sin = sin;

    // Start time and place
    this.t0 = Date.now();
    this.x0 = this.container.x;
    this.y0 = this.container.y;
    this.r0 = this.container.rotation;

    //this.t_slide = 49*Math.sqrt(d); // Physics: Constant acceleration. Not as visually satisfying...
    // t_slide is the time it takes to stop.
    if(t_slide != undefined) this.t_slide = t_slide;
    else                     this.t_slide = 500*(0.5+Math.random());

    // t_scale is an overall scale factor, so you can have random, but change the speed.
    if(t_scale) this.t_scale = t_scale;
    else        this.t_scale = 1;

    // Aim
    this.target_x = this.x0 + d*( this.sin + (Math.random()-0.5) );
    this.target_y = this.y0 + d*(-this.cos + (Math.random()-0.5) );
    this.target_r = this.r0 + d*0.13*(Math.random()-0.5);

    // Tint
    if(tint == undefined) this.sprite.tint = this.tint;
    else {
      this.sprite.tint = tint;
      this.tint = tint;
    }

    // Enable
    this.enable()

    // Return the coordinates
    return [this.target_x, this.target_y, this.target_r, this.d, this.cos, this.sin, this.t_slide, this.t_scale]
  }

  // Starts as above but with specified coordinates.
  start_deterministic(tint, chunk_coordinates) {

    // Unpack the coordinates.
    this.target_x = chunk_coordinates[0];
    this.target_y = chunk_coordinates[1];
    this.target_r = chunk_coordinates[2];
    this.d        = chunk_coordinates[3];
    this.cos      = chunk_coordinates[4];
    this.sin      = chunk_coordinates[5];
    this.t_slide  = chunk_coordinates[6];
    this.t_scale  = chunk_coordinates[7];

    // Start time and place
    this.t0 = Date.now();
    this.x0 = this.container.x;
    this.y0 = this.container.y;
    this.r0 = this.container.rotation;

    // Tint
    if(tint == undefined) this.sprite.tint = this.tint;
    else {
      this.sprite.tint = tint;
      this.tint = tint;
    }

    // Enable
    this.enable()
  }

  // Animate
  animate(delta) {
    if(this.is_disabled()) return;
    
    // Get the scaling factor for our distance to the target
    var fade = fader_impulse(this.t0, this.t_slide*this.t_scale);

    // Get the time since start
    var dt = Date.now()-this.t0;

    // If we're still moving, generate sprays
    if(dt < this.t_slide*this.t_scale && this.chunkgroups_sauce) {

      // Find a landing point for this droplet between here and a little past the destination
      for(var n=0; n<1; n++) { // +this.sprite.width*this.s*0.1

        // Big drops go farther and land faster
        var s = 0.05 + 0.4*(Math.random() + 0.8*Math.random()*this.s);
        this.chunkgroups_sauce.start(
          this.x+this.s*10*(Math.random()-0.5),
          this.y+this.s*10*(Math.random()-0.5), // Starting coordinates = current coordinates+random
          s,                         // Scale of droplet (defined above)
          Math.random()*Math.PI*2,   // Orientation random
          this.d*fade*s*this.s*0.5,  // Distance we travel
          this.cos+s*Math.random(),  // Unit vector cos(rd) (reduces the number of cos calls)
          this.sin+s*Math.random(),  // Unit vector sin(rd) (reduces the number of sin calls)
          false,                     // Auto-calculate the flight time.
          1-0.5*s,                   // Fractional flight time.
          undefined,                 // tint (undefined for default)
        );
      }
    }

    // Set our current location accordingly.
    this.x = this.target_x + (this.x0-this.target_x)*fade;
    this.y = this.target_y + (this.y0-this.target_y)*fade;
    this.r = this.target_r - (this.r0-this.target_r)*fade;
    this.set_sprite_xysr(
      this.target_x + (this.x0-this.target_x)*fade,
      this.target_y + (this.y0-this.target_y)*fade,
      this.s,
      this.target_r - (this.r0-this.target_r)*fade,
    );

    // Update the color based on fade
    // Get the current tint
    var r,g,b,z;
    [r,g,b] = ox_to_rgb(this.tint);
    z = 0.45+0.55*fade;
    this.sprite.tint = rgb_to_ox(r*z, g*z, b*z);

    // We should disable chunks outside of the game
    if(this.x < -0.1*this.game_width 
    || this.y < -0.1*this.game_height
    || this.x >  1.1*this.game_width
    || this.y >  1.1*this.game_width) {
      this.disable();
      return;
    }

    // Finally, if we're supposed to disappear and paint at the end, do so.
    if(this.splatter && dt > this.t_slide*this.t_scale) { 
      this.splatter.paint(this.x, this.y, this.s, this.r, this.sprite.tint);
      this.disable(); // In case we don't paint ourself
    }
  }  

  // Method just paints the image to the floor, leaving the sprite disabled afterward
  paint(x,y,s,r,tint) {
    this.set_sprite_xysr(x,y,s,r);
    this.enable();
    this.sprite.tint = tint;
    renderer.render(this.container, floor_texture, false);
    this.disable();
  }

  // If something damages this (e.g. a bomb), go flying.
  // allow_damage and ignore_delay are just placeholders, so this function looks like that of Character()
  get_hit(source, allow_damage, ignore_delay, damage_scale) {
    
    // Figure out the angle
    var angle = get_angle(this.container.x-source.container.x, this.container.y-source.container.y);

    // Give an impulse based on the damage scale.
    var x = this.s-0.5;
    this.start(damage_scale*50/Math.abs(x*source.max_v), Math.cos(angle), Math.sin(angle));
  }

} // End of Chunk class

// Group of chunks, e.g., arms, head, ...
// layout should be paths as keys and coordinates as values, e.g. 
// {'aliens/arm1.png':[-10,0], 'aliens/head.png':[0,0], ...}
class ChunkGroup {

  constructor(layout, parent, chunkgroups_sauce, splatter, defer_adding, tint) {
    this.parent = parent; 
    
    // Remember the layout
    this.layout = layout;

    // Construct a list of chunks, and a container to hold them all
    this.chunks = {};
    for(var k in layout) {
  
      // Create the chunk
      var c = new Chunk(k, chunkgroups_sauce, splatter, defer_adding, tint);
      this.chunks[k] = c;
      this.parent.chunks.push(c);
    }
  }

  set_enabled (enabled)  {for(var k in this.chunks) this.chunks[k].set_enabled(enabled);}
  set_disabled(disabled) {this.set_enabled(!disabled);}
  enable() {this.set_enabled(true);}
  disable(){this.set_disabled(true);}

  // Sets the geometry of the chunk group. 
  set_xysr(x,y,s,r) {
    
    // Loop over the layout
    var c, dx, dy;
    for(var k in this.layout) {
      c = this.chunks[k];

      // Rotated relative position
      [dx, dy] = rotate_vector([this.layout[k][0], this.layout[k][1]], r);

      // Position plus rotated layout
      c.set_sprite_xysr(x+dx*s, y+dy*s, s, r);
    }
  }

  // Starts the animation
  start(x,y,s,r, d,cos,sin,t_slide,t_scale,tint) {

    // Set the geometry of the group
    this.set_xysr(x,y,s,r);

    // Start the animation for each chunk
    var chunk_coordinates = {}
    for(var k in this.chunks) chunk_coordinates[k] = this.chunks[k].start(d,cos,sin,t_slide,t_scale,tint);

    return chunk_coordinates;
  }

  // Starts the animation for all the supplied chunk coordinates
  // chunks_coordinates = {'player/foot1.png': [target_x, target_y ...], ...}
  start_deterministic(x,y,s,r,tint, chunks_coordinates) {
    
    // Set the geometry of the group
    this.set_xysr(x,y,s,r);

    // Start the animation for each chunk
    for(var k in this.chunks) this.chunks[k].start_deterministic(tint, chunks_coordinates[k]);
  }

  // Animates all the chunks
  animate(delta) {for(var k in this.chunks) this.chunks[k].animate(delta);}
}

// List of ChunkGroups
class ChunkGroups {

  constructor(N, layout, chunkgroups_sauce, splatter, defer_adding, tint) {

    // List of objects
    this.chunk_groups = []; // All chunk groups.
    this.chunks       = []; // All chunks.
    for(var n=0; n<N; n++) this.chunk_groups.push(new ChunkGroup(layout, this, chunkgroups_sauce, splatter, defer_adding, tint));
    this.length = N;
    
    // Our current index
    this.n = 0;
  }

  // Just starts the next chunk group and increments safely
  start(x,y,s,r,d,cos,sin,t_slide,t_scale,tint) {  
    
    // Generally increment first in case start() triggers other start()s
    this.n++; if(this.n >= this.chunk_groups.length) this.n=0;

    // Fire it off.
    return this.chunk_groups[this.n].start(x,y,s,r,d,cos,sin,t_slide,t_scale,tint);
  }
  
  // Just starts the next chunk group and increments safely
  // chunks_coordinates = [[target_x, target_y ...], [target_x, target_y, ...], ...]
  start_deterministic(x,y,s,r,tint, chunks_coordinates) {  
    
    // Generally increment first in case start() triggers other start()s
    this.n++; if(this.n >= this.chunk_groups.length) this.n=0;

    // Fire it off.
    return this.chunk_groups[this.n].start_deterministic(x,y,s,r,tint, chunks_coordinates);
  }

  // Animate all chunks.
  animate(delta) {for(var n=0; n<this.chunks.length; n++) this.chunks[n].animate(delta);}

  // Add to stage
  add_to_stage() {for(var n=0; n<this.chunks.length; n++) stage.addChild(this.chunks[n].container);}
}

// Container of (swappable) images for a gun, clip, etc, with the methods for shooting and animating.
class Gun {

  constructor(root_path) {
    log('New Gun', root_path);

    // Default root path
    if(!root_path) root_path = 'weapons/'

    // Remember the root path
    this.root_path = root_path;
    
    // Normal rifle
    this.rifle_texture   = get_texture(image_root_path+root_path+'rifle.png');
    this.sploder_texture = get_texture(image_root_path+'items/sploders.png');

    // Create a container for the stack of sprites
    this.container   = new PIXI.Container();
    this.sprite_clip = new PIXI.Sprite(texture_empty); 
    this.sprite_gun  = new PIXI.Sprite(this.rifle_texture); 
    this.sprite_clip.anchor.set(0.5,0.5);
    this.sprite_gun .anchor.set(0.5,0.5);
    this.container.addChild(this.sprite_clip);
    this.container.addChild(this.sprite_gun);

    // Add the container to the stage and set up its geometry
    stage.addChild(this.container);

    // Default type
    this.type        = 'rifle';
    this.rounds_type = 'sploders';
    this.rounds      = 0;
  }

  // Depending on the situation, updates the visible sprites.
  update_sprites() {

    // If we have no rounds, the clip is nothing.
    if(this.rounds <= 0) this.sprite_clip.texture = texture_empty;
    else if(this.rounds_type == 'sploders') {

      // Set the clip texture
      this.sprite_clip.texture = this.sploder_texture;
      this.sprite_clip.scale.x = 0.5;
      this.sprite_clip.scale.y = 0.5;

      // Set the clip location.
      var d = 20*(this.rounds/25-0.5)+8;
      this.sprite_clip.x =  SIN30*d;
      this.sprite_clip.y = -COS30*d;
    }
  }
}



// Basic interactive object
class Thing {

  constructor(texture_paths, root_path, scale, type) {

    // Remember the root path.
    this.root_path = root_path;

    // Detremine the object id, and add it to the global lookup table
    this.index = all_things.length;
    all_things.push(this);

    // Set the scale
    if(!scale) scale = 1;
    this.s = scale;
    this.type = type;

    // Physical location and orientation
    this.x = state.game_width *0.5;
    this.y = state.game_height*0.5;
    this.r = 0;

    // Used for push calculations, etc
    this.max_v = 1.0;
    this.radius = state.scale_sprite*this.s/this.max_v;

    // If we should update immediately
    this.immediate = true;

    // Flag defaults.
    this.is_alien  = false;
    this.is_player = false;
    this.can_take  = false; // Items can be taken when this is true.
    this.is_solid  = true;  // Things that beam in are only solid after beaming; i.e. for hitting barrels

    // Visual error on coordinates
    this.ex = 0;
    this.ey = 0;
    this.er = 0;
    this.t_last_e = Date.now(); // Time since error was calculated used for calculating correctory

    // Texture parameters
    this.t_texture_delay = 200;        // How often to switch textures in ms. Overwritten by get_t_texture_delay()
    this._n = 0;                       // Current texture index
    this.t_last_texture = Date.now();  // Time of last texture switch
    this.color = 0xFFFFFF;             // Color to apply

    // Keep a list of texture lists, one for each layer. Also keep track of the number of frames
    this.textures = [];
    this.frame_count = 0;
    var path;
    for(var n=0; n<texture_paths.length; n++) {
      
      // One list of frames per layer; these do not have to match length
      this.textures.push([]); 
      for(var m = 0; m<texture_paths[n].length; m++) {
        
        // Add the actual texture object
        path = image_root_path + root_path + texture_paths[n][m];
        if(resources[path]) this.textures[n].push(resources[path].texture);
        else throw 'No resource for '+ path;

        // Keep track of the max index we encounter. This is our number of frames
        if(m+1>this.frame_count) this.frame_count = m+1;
      }
    }
      
    // Create a container for the stack of sprites
    this.container = new PIXI.Container();
    this.sprites   = [];

    // Loop over the layers, creating one sprite per layer
    for(var n in this.textures) {

      // Create the layer sprite with the zeroth image by default
      var sprite = new PIXI.Sprite(this.textures[n][0])
      
      // Center the image
      sprite.anchor.set(0.5, 0.5);
    
      // Keep it in our personal list, and add it to the container
      this.sprites.push(sprite);
    }

    // Add the sprites to the container (can be overloaded)
    this.fill_container();

    // Add the container to the stage and set up its geometry
    stage.addChild(this.container);
    this.update_sprite_xysr();

    // Disabled by default
    this.disable();

  }

  // Adds the sprites to the container (overloaded in sub-classes)
  fill_container() {
    for(var i=0; i<this.sprites.length; i++) this.container.addChild(this.sprites[i]);
  }

  scare_me() {
    
    // If it's a big sploder, and we're near it, start complaining! Aliens max_v goes from 0.5-1.8.
    if((this.type==ALIEN_SPLODER && this.max_v <= 0.7) || this.type=='barrel') {
        
      // get the player that is me
      var p = players[me.player_index];

      // get the distance from this alien to me
      var dd = (this.x-p.x)*(this.x-p.x) + (this.y-p.y)*(this.y-p.y);

      // if it's too close
      var nono = 200;
      if(dd < nono*nono) players[me.player_index].say('jack/near_sploder', 20);
    }
  }

  // Setting a texture (and resetting the clock!)
  set_texture(n) {
    
      // Loop over the layers, setting the texture of each
      for(var l=0; l<this.sprites.length; l++) {
        
        // Figure out the valid index (make sure there's a texture!)
        var n_valid = Math.min(n, this.textures[l].length-1);
        
        // Set the texture to a valid one.
        this.sprites[l].texture = this.textures[l][n_valid];
      }
  
      // Remember the index we're on for cycling purposes
      this._n = n;
  
      // Record the time of this switch for animation purposes
      this.t_last_texture = Date.now();
  
      // Finish this function for function finishing purposes
    }
  
  // Increment the texture
  increment_texture() {
    if(this._n >= this.frame_count-1) this._n = 0;
    else                              this._n++;
    this.set_texture(this._n);
  }

  // Increment the texture if we've passed a certain amount of time
  increment_texture_delayed() {
    if(Date.now() - this.t_last_texture > this.t_texture_delay)
      this.increment_texture();
  }

  // Enable / disable the sprite
  enable(invert)  {
    if(invert) this.container.visible = false;
    else       this.container.visible = true;
  }
  disable(invert) {
    if(invert) this.container.visible = true;
    else       this.container.visible = false;
  }
  set_enabled(enabled) {this.enable(!enabled);}

  is_enabled()  {return  this.container.visible;}
  is_disabled() {return !this.container.visible;}

  is_me() {return false} // things are not me by default

  // Uses this.x, this.ex, and this.t_last_e to calculate the sprite coordinates
  update_sprite_xysr() {

    // Get the error correction
    var a = fader_linear(this.t_last_e, state.t_error_correction);
    var dx = this.ex*a;
    var dy = this.ey*a;
    var dr = this.er*a;

    // Set the sprite position and angle
    this.container.x        = this.x + dx;
    this.container.y        = this.y + dy;
    this.container.rotation = this.r + dr;
    this.container.scale.x  = this.s*state.scale_sprite;
    this.container.scale.y  = this.s*state.scale_sprite;

    if(this.invert_x) this.container.scale.x *= -1;
  }

  // Collision test with another Thing (Stolen from alien)
  get_pushed_by(c) {
  
    // If it's a test with ourselves or an invisible sprite, no collision.
    if(c == this || this.is_disabled() || c.is_disabled()) return false;

    // Distances
    // If one of the involved is me, use the sprite coordinates so there are no visual surprises.
    if(this.is_me() || c.is_me()) {
      var dx = this.container.x - c.container.x;
      var dy = this.container.y - c.container.y;
    }

    // Otherwise, use the target coordinates to minimize lag issues.
    else {
      var dx = this.x - c.x;
      var dy = this.y - c.y;
    }

    // Combined minimum distance before push
    var r  = this.radius + c.radius;
    var rr = r*r;

    // Calculate overlap. If the minimum radius r
    // is greater than the distance, this is positive = hit!
    // (think of limit dx = dy = 0)
    var dd = dx*dx+dy*dy;
    var sr = this.max_v/c.max_v; 
    var xx  = dd/rr;   
    
    // Hit strength curves with radius, up but doesn't have a pole
    var hh = rr*(1.0 - xx)/(0.05+xx) * sr*sr*sr; 
    
    // Hit!
    if(hh > 0) {
      
      // Return a restoring impulse; if hh is larger, we are closer.
      if(dd > 0) return [hh*dx, hh*dy];

      // Special case: right on top.
      else {
        let angle = Math.random()*Math.PI*2.0;
        return [hh*Math.cos(angle), hh*Math.sin(angle)];
      }
    } 

    else return false

  } // end of get_pushed_by(c);

  // Summed impulse from all collisions (stolen from Alien)
  sum_all_pushes() {

    // reused variable
    var hit; 

    // Summed step size from hit
    var vx = 0;
    var vy = 0;
    var size_scaler;

    // If this is me, try to take any overlapping items.
    if(this.is_player && this.is_me()) {

      // loop over all items and get them if we're touching.
      for(var k in items.items) {
        for(var i in items.items[k]) {
          var item = items.items[k][i];
          if(item.is_touching(this)) this.try_to_take(item);
        }
      }
    }
    
    // Test all barrels
    for(var b=0; b<items.items.barrel.length; b++) {
      
      // Calculate it
      hit = this.get_pushed_by(items.items.barrel[b]);

      // If it's a hit, add to the velocities
      if(hit) {
        vx += hit[0];
        vy += hit[1];
      }
    }

    // test all players
    for(var n=0; n<players.length; n++) {
      
      // Calculate it
      hit = this.get_pushed_by(players[n]);

      // If it's a hit, add to the velocities
      if(hit) {
        vx += hit[0];
        vy += hit[1];
      }
    } // End of player hits

    // These are the participating player indices
    var ns = participant_indices;

    // Biggest alien hits the player. If this is me. :)
    var biggest_alien = null;

    // Loop over player indices
    for(var i=0; i<ns.length; i++) {
      
      // Get the index
      n = ns[i];

      // Loop over alien index
      for(var m=0; m<aliens[n].length; m++) {
        
        // Calculate it
        hit = this.get_pushed_by(aliens[n][m]);

        // If it's a hit, add to the velocities
        if(hit) {

          // Have larger aliens push more
          size_scaler = 1.0/(aliens[n][m].max_v*aliens[n][m].max_v);
          vx += hit[0]*size_scaler;
          vy += hit[1]*size_scaler;
        
          // Keep track of the biggest alien that hits.
          if(biggest_alien == null || aliens[n][m].max_v < biggest_alien.max_v) 
          biggest_alien = aliens[n][m];

        } // End of "hit"
        
      } // End of alien index loop 

    } // End of player indices loop

    // If this is me, get hit. Other players will tell us if they get hit.
    if(this.is_me()) this.get_hit(biggest_alien, true); // null biggest_alien does nothing.
    
    // Scale the push based on size (if an alien)
    if(this.is_player) size_scaler = 1;
    else               size_scaler = this.max_v*this.max_v; // max_v goes from 0.5-1.8 or so
    
    // Send back the summed impulse from all the hits
    return [vx*state.push_scale*size_scaler, vy*state.push_scale*size_scaler];

  } // End of sum_all_pushes()
}


// Item class. Something that appears and you can walk over to collect.
class Item extends Thing {

  constructor(texture_paths, root_path, scale, type) {
    
    // Construct Thing
    super(texture_paths, root_path, scale, type);

    // Define a radius
    this.radius = 12*state.scale_sprite*state.scale_radius;
    
    // Used for push physics. Aliens are 0.5-1.8
    this.max_v = 0.7;

    this.is_player = false;
    this.is_alien  = false;
  }

  // Item gets hit by a bullet
  get_hit(source, allow_harm, ignore_delay, damage_scale, hit_packet) {
    
    // hit_packet = [-1, splat_x, splat_y, splat_scale, r, hit_things[0].index];
    if(hit_packet) {
      var splat_x     = hit_packet[1];
      var splat_y     = hit_packet[2];
      var splat_scale = hit_packet[3];
      var r           = hit_packet[4];

      // Do the visuals and audio

      // Generate the splat locally
      splats_rifle.start(
        splat_x, splat_y, // Where the splat hits
        splat_scale, r,   // scale, rotation
        Math.random()<0.5, false, // flip x, flip y
        this.sprites[0].tint); // Tint matches this tint.

      // Make rifle splat noise
      sounds.play_random(['splat1', 'splat2', 'splat3', 'splat4'], splat_x, splat_y);  

    }

    // Scare me if it's a big sploder
    this.scare_me();
  }

  // Respawn at the specified coordinates (or random)
  respawn(x,y) {

    // Play the noise
    sounds.play('beamdown', x,y);

    // Place it and enable it!
    this.x0 = x;
    this.y0 = y;
    this.x = x;
    this.y = y;
    this.update_sprite_xysr();
    this.enable();
    this.can_take = false;
    this.is_solid = false;
    this.t0 = Date.now();
  }

  animate() {
    
    // We only animate if it's enabled and we cannot take it.
    if(this.is_disabled() || this.can_take) return;

    // Fader value
    var f = fader_linear(this.t0, 3000);

    // Colors and blur
    this.sprites[0].tint  = rgb_to_ox(Math.random(), Math.random(), Math.random());
    this.sprites[0].alpha = 0.9*(1.0-f)*(1.0-f);
    //this.x = this.x0 + (Math.random()-0.5)*40*f;
    this.update_sprite_xysr();

    // Enable taking when done
    if(f==0) {
      this.can_take = true;
      this.is_solid = true;
      this.sprites[0].tint = 0xffffff;
      this.sprites[0].alpha = 1.0;
    }
  }

  // Player is me
  is_me() {return this.is_player && this.player_index == me.player_index;}
  is_mine() {return this.player_index == me.player_index;}

  // If it's touching the supplied Thing
  // Collision test with another Player or Alien
  is_touching(c) {
    
    // If it's a test with ourselves or an invisible sprite, no collision.
    if(c == this || this.is_disabled() || c.is_disabled()) return false;

    // Distances
    // If one of the involved is me, use the sprite coordinates so there are no visual surprises.
    if(c.is_player && c.player_index == me.player_index) {
      var dx = this.container.x - c.container.x;
      var dy = this.container.y - c.container.y;
    }

    // Otherwise, use the target coordinates to minimize lag issues.
    else {
      var dx = this.x - c.x;
      var dy = this.y - c.y;
    }

    // Combined minimum distance
    var r  = this.radius + c.radius;
    return dx*dx+dy*dy < r*r;

  } // end of is_touching(c)

}

class Items {

  constructor() {

    // Create an object holding lists of items
    this.items = {};
    
    // Create each type of item according to state
    this.create_items('health',   state.n_health,   0.4);
    this.create_items('sploders', state.n_sploders, 0.4);
    this.create_items('barrel',   state.n_barrel,   0.4);
  }

  create_items(type, number, scale) {
    console.log('Creating', type, scale);

    // List of item objects for this type
    this.items[type] = [];
    for(var i=0; i<number; i++) 
      this.items[type].push(new Item([[type+'.png']], "items/", scale, type));
  }

  // Safely cycles through this item type and respawns it at the specified location (or random if unspec'd)
  respawn(type, x, y) {

    // Find the first unused item and respawn it.
    for(var i=0; i<this.items[type].length; i++) {
      if(this.items[type][i].is_disabled()) {
        // Respawn & quit
        this.items[type][i].respawn(x,y);
        return;
      }
    }
  }

  // Animate those that are enabled
  animate() {

    // Loop over the types of items and each item of each type and animate
    for(var type in this.items) 
      for(var i=0; i<this.items[type].length; i++) 
        this.items[type][i].animate();
  }

}


class Health extends Item {

  constructor(texture_paths, root_path, scale) {

  }
}

class Explosives extends Item {

  constructor(texture_paths, root_path, scale) {

  }
}

class Chaingun extends Item {

  constructor(texture_paths, root_path, scale) {

  }
}

// Object to hold character information and texture switches, etc.
class Player extends Thing {

  // Creating the object. The supplied texture list should be a list of 
  // string paths for getting resources['path'].texture
  constructor(texture_paths, root_path, scale) {
    log('New Player', texture_paths, root_path, scale);

    // Run the base object stuff.
    super(texture_paths, root_path, scale, 0);

    // Type
    this.is_player = true;
    this.is_alien  = false;

    // Sauce tint is red.
    this.tint_sauce = 0xFF3333;
    
    // Movement variables
    this.vr     = 0;    // Current rotation rate (and scale)
    this.max_vr = 0.04; // Max rotation v
    this.max_v  = 2.0;  // Max speed (2 for player)
    this.v      = 0;    // Current movement speed (and scale)
    this.radius = 12*state.scale_sprite*state.scale_radius;   // Nominal radius
    
    // Current components (overwritten a lot)
    this.vx = 0;
    this.vy = 0;
    this.invert_x = false; // Default righthanded for players. Could be a cookie.

    // shoot variables
    this.is_shooting    = false; // whether the player is shooting currently.
    this.t_shoot1_delay = 120;
    this.t_last_shoot1  = 0; // Starts faded!
    this.t_last_hit     = 0; // Hasn't been hit yet!

    // Health
    this.health      = 100;       // Always assumed to be maxing out at 100.

    // Sound id for current thing the player is saying
    this.say_id  = null;
    this.say_key = null;

    // Shooting aliens up close repeatedly
    this.close_hit_count  = 0;
    this.t_last_close_hit = 0;
  }

  // Player is me
  is_me() {return this.is_player && this.player_index == me.player_index;}
  is_mine() {return this.player_index == me.player_index;}

  // Stops whatever we're saying.
  shutup() {
    if(this.say_key) {
      // Get the howl.
      var h = sounds.sounds[this.say_key].howl;
      
      // Fade it out quickly (3 ms).
      if(h.playing()) h.fade(h.volume(),0,3,this.say_id);
    }
  }

  // Makes the noise at the current location and (if it's me saying it) sends it to the server
  // so everyone else can hear it
  // path is a spec path for sounds.say()
  say(path, priority, interrupt_same) {

    // The dead don't speak
    if(this.is_disabled()) return;
    
    if(priority       == undefined) priority =0;
    if(interrupt_same == undefined) interrupt_same=false;

    // If we're supposed to interrupt, we haven't played anything, or the sound isn't playing any more.
    // say_key is the sound key, e.g., 'whoops1', while say_id is the thing returned by howl.
    if(priority > this.say_priority 
    || (priority == this.say_priority && interrupt_same)
    || !this.say_id 
    || !sounds.sounds[this.say_key].howl.playing(this.say_id)) {
      
      // Stop whatever might be playing
      this.shutup();

      // Play it, remembering the current key.
      [this.say_key, this.say_id] = sounds.play(path, this.x, this.y);
      this.say_priority = priority;

      // Broadcast if we're supposed to
      log('Sending_say', path+'/'+this.say_key);
      if(this.is_me()) me.emit('say', [me.player_index, path+'/'+this.say_key, priority, interrupt_same]);
    }
  }

  fill_container() {
    this.container.addChild(this.sprites[0]);
    this.gun = new Gun('weapons/');
    this.container.addChild(this.gun.container);
    this.container.addChild(this.sprites[1]);
  }

  // If the player is shooting, make the noise and return a list of hit objects
  shoot() {

    // Pull the trigger if we're shooting and we haven't shot for awhile
    if(this.is_shooting && Date.now()-this.t_last_shoot1 > this.t_shoot1_delay) {

      // Reset the clock
      this.t_last_shoot1 = Date.now();

      // Increase the shot count for ourselves
      if(me.player_index==this.player_index) players[me.player_index].stats.shots++;

      // Get the angle, run and rise, for the visible (sprite) angle
      if(this.invert_x) var aim = 1;
      else              var aim = -1;
      var r = this.container.rotation+aim*Math.PI/3;
      var a = Math.cos(r);
      var b = Math.sin(r);
      var s = 0.7 + 0.6*Math.random();

      // Start the muzzle flash in the right place, visually (sprite, not actual)
      flashes_rifle.start(
        this.container.x+3.55*b*this.radius * (1+(s-1)*0.5),
        this.container.y-3.55*a*this.radius * (1+(s-1)*0.5), 
        s, r, Math.random()<0.5);
      
      // blinder
      //add_to_blinder(0.2); // Alas, it's more important that flashes be below aliens than this piece of ambiance. Probably not good for headaches, either.
    
      // Play the shoot noise
      sounds.play('shoot', this.x, this.y);

      // Remove special rounds we do this even for other players locally. Only the explosions are sent by the other players
      if(this.gun.rounds > 0) {
        this.gun.rounds--;
        var rounds_type = this.gun.rounds_type;
        this.gun.update_sprites();
      }
      else var rounds_type = null;
      
      // Only calculate what the line collides with if it's us.
      if(this.is_me()) {

        // Reused variables
        var x0, y0, dd;

        // List of all objects that can be hit.
        var things = items.items['barrel'];
        for(var n=0; n<aliens.length; n++) things = things.concat(aliens[n]);

        // Construct a list of all hit objects, including aliens, barrels, etc
        // Each will have attribute hit_RR for the distance squared from the source.
        var hit_things = []

        for(var i=0; i<things.length; i++) {
          
          // Must be enabled and solidified (beamed down)
          if(things[i].is_enabled() && things[i].is_solid ) {

          // Teamwork mode with ghost enemies, or it's not mine (so I can hit it), or it's a spoder (always hit) or 
          // Now in teamwork mode, you hit them but do no / greatly reduced damage.
          // && (!state.mode_teamwork || !things[i].is_mine() || things[i].type == ALIEN_SPLODER ) ){

            // For the distances, we use the sprite (visible) coordinates to keep it as real-looking as possible
            x0 = things[i].container.x - this.container.x;
            y0 = things[i].container.y - this.container.y; 

            // Calculate the distance squared from the line
            dd = (a*x0+b*y0)*(a*x0+b*y0)/(a*a+b*b);

            // If it's within the radius squared and in the right direction, hit the things[i]
            if(dd < things[i].radius*things[i].radius 
              && b*x0 > a*y0 // dot product > 0 (right direction!)

              // And it's within bounds!
              && things[i].x+things[i].radius > 0
              && things[i].x-things[i].radius < state.game_width
              && things[i].y+things[i].radius > 0
              && things[i].y-things[i].radius < state.game_height) {
                
              // Add a little distance info
              things[i].hit_RR = x0*x0 + y0*y0;
              hit_things.push(things[i]);
            }
          } // end of hittable thing

        }  // end of thing collisions
      
        


        // Find the closest and nail it.
        if(hit_things.length) {
          sort_objects_by_key(hit_things,'hit_RR');

          // Make the splat at radius hit_R, image scale s
          var hit_R = Math.sqrt(hit_things[0].hit_RR);
          s = 0.7 + 0.5*Math.random();

          // Where our line hits
          var xh = this.container.x + b*hit_R;
          var yh = this.container.y - a*hit_R;

          // Distance^2 between hit and thing center
          var dxh = xh-hit_things[0].container.x;
          var dyh = yh-hit_things[0].container.y;
          var rrh = dxh*dxh + dyh*dyh;

          // Hit thing's profile
          var drh = hit_things[0].radius - 0.7*rrh/hit_things[0].radius;

          // Aim bonus
          var aim_bonus = 1.2*drh/hit_things[0].radius;
          
          // Close-up bonus
          var closeup_bonus = 1 + 2/(1+0.5*hit_things[0].hit_RR/(this.radius*this.radius));
          
          // Update the up close reps and yell
          if(closeup_bonus > 1.10) {
            this.close_hit_count = 1 + this.close_hit_count * fader_smooth(this.t_last_close_hit, 500);
            this.t_last_close_hit = Date.now();
          }
          if(this.close_hit_count > 5.3) {
            //this.say('jack/diediedie', 20, true);
            this.close_hit_count = 0;
          }
          log('close_hit_count', this.close_hit_count);

          // If this player has sploders, detonate.
          if(rounds_type == 'sploders') {

            // Keep track of hits
            this.gun.rounds_hits++;
            
            // Get the explosion geometry
            var sploder_x = xh-b*drh*0.5;
            var sploder_y = yh+a*drh*0.5;

            // Add this to the hit packets; -2 means sploder hit
            hit_thing_packets.push([-2, sploder_x, sploder_y, hit_things[0].index])

            // Detonate the actual explosion, let this do the damage.
            explosions.detonate(
              sploder_x, sploder_y, // Location a bit more internal
              state.rounds_sploder_radius,          // Radius
              true,                                 // harm_aliens
              state.rounds_player_harm_scale,       // self harm reduction
              state.rounds_sploder_damage_scale,    // how much to scale the damage of the explosion
            );
          }

          // Otherwise non-sploder rounds: run the splat mark using the distance and the aim a & b
          else {

            // Calculate the splat geometry
            var splat_x = xh-b*drh;
            var splat_y = yh+a*drh;
            var splat_scale = s*closeup_bonus*aim_bonus;
            
            // Tell everyone about the splat, -1 means normal hit
            var hit_packet = [-1, splat_x, splat_y, splat_scale, r, hit_things[0].index];
            hit_thing_packets.push(hit_packet);

            // Hit em, push them back, damage them. Other players will send damage updates for theirs
            //                  source, allow_harm, ignore_delay, damage_scale
            hit_things[0].get_hit(this, true, true, closeup_bonus*aim_bonus, hit_packet);
          }

          // Calculate the new total for the average calculation
          var stats         = players[me.player_index].stats
          var closeup_total = stats.personal*stats.hits + closeup_bonus;
          var aim_total     = stats.aim     *stats.hits + aim_bonus;
          
          // Increment the hit count
          stats.hits++;

          // Get the new average.
          stats.personal = closeup_total / stats.hits;
          stats.aim      = aim_total     / stats.hits;

          // Reset the consecutive misses
          this.gun.rounds_consecutive_misses = 0;

          // Increment consecutive hits
          this.gun.rounds_consecutive_hits++;

          // Say something
          if(this.is_me() && rounds_type=='sploders' && this.gun.rounds_consecutive_hits >= 8) this.say('jack/kill_spree');
        
        } // end of "at least one alien hit"

        // MISS: track this consecutive misses and complain.
        else {
          
          // Reset the consecutive hits
          this.gun.rounds_consecutive_hits = 0;

          if(this.is_me()) {

          /*// For sploder rounds
          if(rounds_type == 'sploders') {

            // Increment
            this.gun.rounds_consecutive_misses++;

            // If we hit only 5, complain
            if     (this.gun.rounds_consecutive_misses >= 20) this.say('jack/missepic');
            else if(this.gun.rounds_consecutive_misses >= 10) this.say('jack/miss');
          }*/
          }
        }

        // If we're out of rounds (last round), make a statement
        if(this.is_me()) {

          // If we fired the last round
          if(rounds_type=='sploders' && this.gun.rounds <= 0) {

            // Evaluate self
            if(this.gun.rounds_hits <= 3)  this.say('jack/missepic', 20);
            else if(state.score - this.gun.rounds_starting_score < 25*n_enabled) this.say('jack/miss', 20);
          }
        }
        
      } // End of "I'm shooting, find what it hits."

    } // end of "pull the trigger"

  } // End of shoot()

  // Player takes damage from the supplied source (Character)
  get_hit(source, allow_harm, ignore_delay, damage_scale) {
    
    // Null hit (no alien hit us)
    if(!source) return;

    // Default damage scale
    if(isNaN(damage_scale)) damage_scale = 1;

    // Player gets hit, but only if they haven't been hit in awhile, or it's a guaranteed hit
    if( ignore_delay || Date.now()-this.t_last_hit > state['t_player_hit_delay']*(0.4+1.6*Math.random()) ) {
      
      // get the direction of the hit
      var dx = this.container.x - source.container.x;
      var dy = this.container.y - source.container.y;
      if(dx || dy) var di = 1.0/Math.sqrt(dx*dx+dy*dy);
      else         var di = 0.0;

      // Remember the last hit time
      this.t_last_hit = Date.now();

      // Calculate damage, faster, smaller aliens hurt less. Aliens currently go from 0.5 to 1.8
      //                                    Damage from ~ 1 to 45.
      if(source.max_v > 0.3) var damage = (10/(source.max_v-0.3)-5)*state.damage_multiplier*damage_scale; 
      else                   var damage = 50*state.damage_multiplier*damage_scale;
      
      // Quit out if no damage
      if(damage <= 0) return;

      // Add to sauce production stat
      this.stats.sauce += Math.min(damage, this.health);
      
      // Remove health (may affect movement etc)
      this.health -= damage;

      // Launch sauce accordingly.
      this.launch_sauce(damage, dx*di, dy*di);
      
      // Since this is us getting hit, dim based on how hard a hit
      // Increment the blinder in a way that saturates at 1.
      add_to_blinder(damage*0.03, 0.1);
      
      // Only I can let myself die
      if(this.health <= 0 && this.player_index == me.player_index) {
        this.die(true, this.death_count+1, damage*1.5, 
          get_angle(this.container.x-source.container.x, this.container.y-source.container.y));
        return;
      }

      // Stunned determined by remaining health and hit strength.
      var f = 0.01*(100-this.health) - 0.5; if(f<0) f=0;  
      var g = 70 * f + damage        - 7;   if(g<0) g=0;
      stunned += g;
    
      // Make human noise based on damage & health
      var key = null;
      var id  = null;
      if     (this.health > 50) this.say('jack/pain1', 10, true);
      else if(this.health > 25) this.say('jack/pain2', 10, true);
      else if(this.health > 0 ) this.say('jack/pain3', 10, true);

      // pushback based on damage. Player can push through damage a bit more.
      var push_scale = 0.05*damage*damage/(1+damage*0.1)
      this.x += dx*di * push_scale;
      this.y += dy*di * push_scale;

      // Send this human noise and player packet for movement / health
      log('sending_ph',  this.player_index, damage);
      me.emit(    'ph', [this.player_index, object_to_full_packet(this), damage, dx*di, dy*di]);
    }
    
  } // End of get_hit();

  // Primarily used for when a player gets hit.
  launch_sauce(damage, dxi, dyi) {
    
    // Launch the sauce! 
    for(var i=0; i<damage*2; i++) 
      chunkgroups_player_droplets.start(
        this.x-dxi*this.radius, // x
        this.y-dyi*this.radius, // y 
        0.2+0.7*Math.random(),    // s
        Math.PI*2*Math.random(),  // r
        0.5*damage*damage+3,      // distance
        Math.random()-0.5, //dyi,
        Math.random()-0.5, //-dxi,
        undefined,
        undefined,
        TINT_PLAYER_SAUCE); // tint
  }

  // Die. Positional arguments are here to match those of the aliens so either can call easily.
  die(was_me, new_death_count, d, rd) {
    
    // Disable sprite
    this.disable();
    this.shutup();

    // Start the chunks      (x,y,s,r,d,cos,sin,t_slide,t_scale,tint)
    var chunks_coordinates = chunkgroups_players.start(
      this.x,this.y,this.s*state.scale_sprite,this.container.rotation,
      d*4, Math.cos(rd), Math.sin(rd), undefined, undefined,
      player_colors[this.player_index]); // tint
    
    // Play a death noise
    sounds.play('pop/pop4', this.x, this.y);

    // If it's me, update my stats and tell everyone.
    if(this.is_me()) {

      // Update my name in the stats
      this.stats['name'] = state.clients[me.id].name;
      this.stats['chunk_distance'] = d;
      this.stats['score'] = state.score;

      // Send it to everyone.
      log('Senging_pd', [this.player_index, object_to_full_packet(this), players[me.player_index].stats, chunks_coordinates]);
      me.emit(    'pd', [this.player_index, object_to_full_packet(this), players[me.player_index].stats, chunks_coordinates]);
    }

  } // End of die()

  // Die with pre-defined chunks_coordinates 
  die_deterministic(chunks_coordinates) {
    
    // Disable sprite
    this.disable();
    this.shutup();

    // Start the chunks (x,y,s,r,d,cos,sin,t_slide,t_scale,tint)
    chunkgroups_players.start_deterministic(
      this.x, this.y, this.s*state.scale_sprite, this.container.rotation, player_colors[this.player_index],
      chunks_coordinates); 
    
    // Play a death noise
    sounds.play('pop/pop4', this.x, this.y);

  } // End of die()  

  // Sends a full packet about this object to server and everyone
  send_full_packet() {
    var p = object_to_full_packet(this);
    log('Sending_u', this.player_index, this.alien_index);
    me.emit('u', [this.player_index, this.alien_index, p]);
  }

  // Import a packet sent from the server
  import_packet(packet, immediate) {
    
    // Unpacket
    var object = full_packet_to_object(packet)

    // The new values of x & y should match,
    // but they won't due to *variable* lag, so store the error, which
    // we will reduce over time to make it smooth.
    this.t_last_e = Date.now(); // start time for error smoothing
    // error values calculated below.

    this.type     = object.type;
    this.x        = object.x;
    this.y        = object.y;
    this.health   = object.health;
    this.invert_x = object.invert_x; // Used to scale the sprite, even for aliens
         
    this.v   = object.v;
    this.r   = object.r; 
    this.vr  = object.vr;
    this.is_shooting = object.is_shooting;
    
    this.health = object.health; // 5
        
    // If it's immediate mode, kill the error so it moves immediately
    if(object.immediate || immediate) {
      this.ex = 0;
      this.ey = 0;
      this.er = 0;
      this.t_last_e = 0;
    
    // Otherwise, for maximum smooth, we use the visual coordinates as the starting position
    } else {
      this.ex = this.container.x-this.x;
      this.ey = this.container.y-this.y; 
      this.er = this.container.rotation-this.r;
    }

    // Update the coordinates for whoever we imported.
    this.update_sprite_xysr();
  }

  // Takes the specified item. Can be called by everyone.alled by everyone.
  take(item, other_data) {
    
    // Only take items that are still enabled!
    if(item.is_enabled()) {

      // Different things for different items.
      switch(item.type) {
        case 'health':

          // No matter what, the original item is disabled
          item.disable();

          // Make the right non-human noise and kick if need be
          
          // If we get null data, it's a normal take
          if(other_data == null) sounds.play('health', this.x, this.y);

          // Otherwise, we got an angle for which direction to kick it
          else {
            // Make a noise and kick.
            sounds.play('kick_health', item.x, item.y);          
            chunkgroups_health.start(item.x,item.y,item.s*state.scale_sprite,item.container.rotation,
              150, Math.cos(other_data), Math.sin(other_data), undefined, 0.4); 
          }

          // Point out dickery if it's me
          if(this.is_me()) {
            if     (this.health >= 100) this.say('jack/kick_health');
            else if(this.health >= 90)  this.say('jack/wasteful');
          }

          // Add the health (need to do this even if kicked)
          this.health += 25;
          if(this.health > 100) {
            // Keep track of dickery
            if(this.is_me()) this.stats.wasted_health += this.health-100;
            this.health = 100;
          }
          break;

        case 'sploders':
          item.disable();
          sounds.play('clip1', this.x, this.y);
          
          // Keep track of dickery
          if(this.is_me()) this.stats.wasted_rounds += this.gun.rounds;

          // Point out dickery.
          if(this.is_me() && this.gun.rounds >= 20 && this.gun.rounds_type == 'sploders')
            this.say('jack/wasteful');
          
          // If it's me, say something about it.
          else if(this.is_me()) this.say('jack/got_ammo');

          // Fill the clip.
          this.gun.rounds                  = 25;
          this.gun.rounds_hits             = 0;
          this.gun.rounds_starting_score   = state.score;
          this.gun.rounds_consecutive_hits = 0;  // While holding the trigger.
          this.gun.rounds_consecutive_misses           = 0;  // Since last hit
          this.gun.rounds_type             = 'sploders';

          break;
      }

      // Always update the gun sprite
      this.gun.update_sprites();

    } // End of "still enabled"
  }

  // Try to take item (asks server). This is only called by me.
  try_to_take(item) {

    // Only proceed if still can take
    if(!item.can_take) return;

    // Get other data for special cases:
    var other_data = null; // Default

    // If we're taking health and we're already at 100, kick data
    if(item.type == 'health' && this.health >= 100) {

      // send rotation if we're at 100 health so they know where to kick it.
      if(key_back) other_data = this.r+Math.PI;
      else         other_data = this.r;
    }

    // Ask the server
    item.can_take = false;
    log('Sending_take', [this.index, item.index, other_data], item.type);
    me.emit(    'take', [this.index, item.index, other_data]);
  }

} // End of Player




// Object to hold character information and texture switches, etc.
// This will be used for people, aliens, etc...
class Alien extends Thing {

  // Creating the object. The supplied texture list should be a list of 
  // string paths for getting resources['path'].texture
  constructor(texture_paths, root_path, scale, type) {

    // Run the base object stuff.
    super(texture_paths, root_path, scale, type); // sets self.type. Can be ALIEN_NORMAL or ALIEN_SPLODER

    // If we're a player or alien
    this.is_player = false;
    this.is_alien  = true;

    // Tint of generated sauce
    this.tint_sauce = 0xFFFFFF;
    
    // Movement variables
    this.vr     = 0;    // Current rotation rate (and scale)
    this.max_vr = 0.04; // Max rotation v
    this.max_v  = 2.0;  // Max speed (2 for player)
    this.v      = 0;    // Current movement speed (and scale)
    this.radius = 12*state.scale_sprite*state.scale_radius;   // Nominal radius
    
    // Current components (overwritten a lot)
    this.vx = 0;
    this.vy = 0;

    // Health
    this.health      = 100;       // Always assumed to be maxing out at 100.
    this.death_count = 0;
  }



  take_damage_alien(source, allow_harm, damage, send_packet) {
    
    // Do nothing if no source or already already disabled.
    // Aliens only get pushed or injured if allow_harm == true
    // Animations for bullet impacts etc come from 'ah' events now.
    if(!source || !allow_harm || this.is_disabled()) return;

    // get the direction of the hit
    var dx = this.container.x - source.container.x;
    var dy = this.container.y - source.container.y;
    if(dx || dy) var di = 1.0/Math.sqrt(dx*dx+dy*dy);
    else         var di = 0.0;
    
    // If we're allowed to harm it subtract health and let it die if necessary
    if(allow_harm) {

      // Remove health (may affect movement etc)
      this.health -= damage;

      // Scare me if it's a sploder
      this.scare_me();

      // If it's dead, kill it
      if(this.health <= 0) {
        //      was_me      death_count      spray_distance       sprayngle
        this.die(true, this.death_count+1, damage*1.5, 
          get_angle(this.container.x-source.container.x, this.container.y-source.container.y)); 
      }

      // Otherwise, just queue the damage update for later sending
      // allow_harm=False when someone else's sprite just looks like it's hitting. Actual hits come from the server.
      // Send packet is false if we're dealing with a server hit packet when we called this function.
      //
      // Alien hit packet is [source_id, target_id, damage]
      else if(allow_harm && send_packet) {

        // Add the hit packet
        hit_thing_packets.push([source.index, this.index, damage]);
      }
    }
    
    // If it's not dead, push it back based on damage. We do this
    // Second because we don't want dying / exploding aliens to be pushed back first.
    if(this.is_enabled()) {

      // In teamwork mode, we boost the push of our own aliens so 
      // they don't just run at us unimpeded. Which is funny, but it's nice to push them a bit.
      if(state.mode_teamwork && source.is_me() && this.type == ALIEN_NORMAL && this.is_mine()) {
        var s = 1.0-state.mode_teamwork; 
        if(s==0) s = 1;
      }
      else var s = 1;

      // Nominal values
      var push_x = dx*di * damage*0.5 * this.max_v / s; 
      var push_y = dy*di * damage*0.5 * this.max_v / s;

      log('pushing alien', push_x, push_y, 'scaled', s);
      this.x += push_x;
      this.y += push_y;
    }
  }

  is_me() {return false;}
  is_mine() {return this.player_index == me.player_index;}

  // Alien gets hit by bullet, causing a splat, scaring me if it's a sploder, and, if allowed, takes damage.
  get_hit(source, allow_harm, ignore_delay, damage_scale, hit_packet) {
    
    // hit_packet = [-1, splat_x, splat_y, splat_scale, r, hit_things[0].index];
    // Do the visuals and audio.
    if(hit_packet) {
      var splat_x     = hit_packet[1];
      var splat_y     = hit_packet[2];
      var splat_scale = hit_packet[3];
      var r           = hit_packet[4];

      // Generate the splat locally
      splats_rifle.start(
        splat_x, splat_y, // Where the splat hits
        splat_scale, r,   // scale, rotation
        Math.random()<0.5, false, // flip x, flip y
        this.sprites[0].tint); // Tint matches this tint.

      // Make rifle splat noise
      sounds.play_random(['splat1', 'splat2', 'splat3', 'splat4'], splat_x, splat_y);  
    }

    // If no source is supplied or we're not allowing harm, stick to pure A/V
    if(!source || !allow_harm) return;

    // Default damage scale.
    if(!damage_scale) damage_scale = 1;

    // Calculate damage
    var damage = 30*this.max_v*this.max_v*damage_scale; // Can change for different guns & aliens

    // Correction for teamwork mode
    if(source && source.is_me() && state.mode_teamwork && !(this.type==ALIEN_SPLODER)) 

      // Weaker against my aliens, stronger against others' aliens.
      if(this.is_mine()) damage = damage*(1-state.mode_teamwork);
      else               damage = damage*1.5;

    // Take damage as an alien and die if needed.
    this.take_damage_alien(source, allow_harm, damage, true);

  } // End of get_hit();

  // Primarily used for when a player gets hit.
  launch_sauce(damage, dxi, dyi) {
    
    // Launch the sauce! 
    for(var i=0; i<damage*2; i++) 
      chunkgroups_player_droplets.start(
        this.x-dxi*this.radius, // x
        this.y-dyi*this.radius, // y 
        0.2+0.7*Math.random(),    // s
        Math.PI*2*Math.random(),  // r
        0.5*damage*damage+3,      // distance
        Math.random()-0.5, //dyi,
        Math.random()-0.5, //-dxi,
        undefined,
        undefined,
        TINT_ALIEN_SAUCE); // tint
  }

  // Die.
  die(was_me, new_death_count, d, rd) {
    
    // Death sequence for alien that is not already dead
    if(new_death_count > this.death_count) {

        // Update the death count
        this.death_count = new_death_count;

        // Disable it before the explosion so the explosion doesn't re-damage it.
        this.disable();
      
        // Make a "pop" sound depending on the kill rate
        var r = state.kill_rate * fader_smooth(t_last_kill, state.t_kill_rate_lifetime); 
        if(r > 5) sounds.play('pop',  this.x, this.y, this.max_v);
        else      sounds.play('drip', this.x, this.y, this.max_v);      
        
        // If it was a splodalien, explosion.
        if(this.type == ALIEN_SPLODER) explosions.detonate_source(this, was_me);
        
        // Otherwise, make a normal chunky collapse
        else {

          // Start the chunks
          chunkgroups_aliens.start(
          this.container.x, this.container.y, 
          this.container.scale.x,  
          this.container.rotation, 
          d, Math.cos(rd), Math.sin(rd),
          undefined, undefined,
          this.sprites[0].tint);
         
          // Choose a noise depending on the current kill rate.
          sounds.play('alien', this.x, this.y, this.max_v);
        }

        // If it was me, I'm responsible for telling everyone and propagating issues.
        if(was_me) alien_kill_packets.push([this.player_index, this.alien_index, this.death_count, d, rd]);

    } // End of alien death sequence
  
  } // End of die()

  // Calculates the texture delay based on speed.
  get_t_texture_delay() {
    return 200/(0.2+this.max_v*this.max_v);
  }

  set_tint() {

    // If it's a sploder, use sploder tint.
    if(this.type == ALIEN_SPLODER) { 
      this.sprites[0].tint = TINT_ALIEN_SPLODER;
      this.tint_sauce      = 0xFFFFFF;
    }

    // If it's a normal alien
    else {
      
      // If we're in teamwork mode, normal aliens match the player tint.
      if(state.mode_teamwork) {
        this.sprites[0].tint = player_colors[this.player_index];
        this.tint_sauce      = player_colors[this.player_index];
      }

      // If we're not in teamwork mode, no tint.
      else{
        this.sprites[0].tint = 0xFFFFFF;
        this.tint_sauce      = 0xFFFFFF;
      }

    } // End of normal alien.

  } // End of set_tint()

  // Respawn
  respawn() {
    
    // Alien type = sploder
    if(Math.random() < state.splodalien_probability) this.type = ALIEN_SPLODER;
    else                                             this.type = ALIEN_NORMAL;
      
    // Automatically sets the tint based on the type of alien and game mode
    this.set_tint();

    // physical parameters
    this.max_v = 0.5+1.3*Math.random(); // 0.5-1.8 (player is 2.0)
    this.v     = this.max_v;
    this.t_texture_delay = this.get_t_texture_delay();
    this.set_alien_geometry(); // Sets up the size of the sprite and radius based on max_v
    this.health = 100;         // Damage reduced on get_hit()
    
    // Random location outside
    var r = state.game_width*1.5*(0.5+0.1*Math.random()); // Radius outside the corner
    var t = Math.PI*2*Math.random();
    this.x = state.game_width *0.5 + r*Math.cos(t); 
    this.y = state.game_height*0.5 + r*Math.sin(t);

    // No error. Make this immediate so the alien doesn't streak from its last resting place
    this.ex = 0;
    this.ey = 0;
    this.er = 0;

    // Update the coordinates so we don't damage ourselves. At the middle.
    this.update_sprite_xysr();

    // Enable the sprite
    this.enable();

    // Temporary immediate flag to send with the next packet so others to know to move it without smoothing.
    // This is set to false after the next packet is created.
    this.immediate = true;

    // Send a single packet
    this.send_full_packet();
  }

  // Sends a full packet about this object to server and everyone
  send_full_packet() {
    var p = object_to_full_packet(this);
    log('Sending_u', this.player_index, this.alien_index);
    me.emit('u', [this.player_index, this.alien_index, p]);
  }

  // Import a packet sent from the server
  import_packet(packet, immediate) {
    
    // Unpacket
    var object = full_packet_to_object(packet)

    // The new values of x & y should match,
    // but they won't due to *variable* lag, so store the error, which
    // we will reduce over time to make it smooth.
    this.t_last_e = Date.now(); // start time for error smoothing
    // error values calculated below.

    this.type     = object.type;
    this.x        = object.x;
    this.y        = object.y;
    this.health   = object.health;
    this.invert_x = object.invert_x; // Used to scale the sprite, even for aliens
      
    this.max_v = object.v; // Provides size info too. 
    this.v     = object.v;
    this.t_texture_delay = this.get_t_texture_delay();  // Size and texture delay related.
    
    this.health = object.health; // 5
    
    // If the incoming death count is lower than ours, the incoming packet is
    // outdated (they have not receive the kill yet). This means the alien must
    // be dead, because only the player sending packets about this alien can 
    // respawn it.
    if(object.death_count < this.death_count) this.disable();
    
    // Otherwise, this is recent enough that we should defer to the owner
    else {
      // Do not update death_count because it is used
      // to determine whether to do the alien death sequence, and 
      // the death_count should therefore be set only by the server 
      // or locally via die() 
      this.set_enabled(object.enabled);
    }

    // If it's immediate mode, kill the error so it moves immediately
    if(object.immediate || immediate) {
      this.ex = 0;
      this.ey = 0;
      this.t_last_e = 0;
    
    // Otherwise, for maximum smooth, we use the visual coordinates as the starting position
    } else {
      this.ex = this.container.x-this.x;
      this.ey = this.container.y-this.y; 
    }

    // If it's enabled and an alien
    if(this.is_enabled()) {
      
      // Sets the size etc based on max_v
      this.set_alien_geometry();

      // Set the tint
      this.set_tint();  
    }
    
    // Update the coordinates for whoever we imported.
    this.update_sprite_xysr();

  }

  // Import an alien minipacket sent from the server
  import_alien_minipacket(packet) {
    
    // Unpacket
    var object = alien_minipacket_to_object(packet)

    // The new values of x & y should match,
    // but they won't due to *variable* lag, so store the error, which
    // we will reduce over time to make it smooth.
    this.t_last_e = Date.now(); // start time for error smoothing
    // error values calculated below.
   
    // TO AVOID ALIENS REAPPEARING:
    //
    // If the incoming death count is lower than ours, the incoming packet is
    // outdated (the sender has not receive the kill yet). This means the alien must
    // be dead, because only the player sending packets about this alien can 
    // respawn it.
    if(object.death_count < this.death_count) this.disable();
    
    // Otherwise, this is recent enough that we should defer to the owner
    else {
      // Do not update death_count because it is used
      // to determine whether to do the alien death sequence, and 
      // the death_count should therefore be set only by the server 
      // or locally via die() 
      this.set_enabled(object.enabled);
    }

    // If it is enabled, set the position 
    if(this.is_enabled()) {
      this.x      = object.x;
      this.y      = object.y;
    }

    // We always smooth a minipacket. They only come with full updates.
    this.ex = this.container.x-this.x;
    this.ey = this.container.y-this.y; 

    // Update the coordinates for whoever we imported.
    this.update_sprite_xysr();
  }

  // Sets up the alien geometry
  set_alien_geometry() {
    this.radius = 12*state.scale_radius*state.scale_sprite/this.max_v;
    this.s = 0.4/this.max_v;
    this.update_sprite_xysr();
  }

} // End of Alien


/////////////////////////////
// EVENTS                  //
/////////////////////////////
let key_forward = false;
let key_back    = false;
let key_left    = false;
let key_right   = false;
let key_changed_send_update = false;

// Whenever a key is pressed or released.
function event_key(e) {
  log('key', e.code);
  
  // Special case for observers too: Escape toggles settings
  if(e.code == 'Escape' && e.type == 'keydown') toggle_pause();

  // If we're not ready, not supposed to interact with the game,
  // toggling full screen (F11), or using an input, don't 
  // change the default behavior of the keys.
  if(!me.ready_for_play 
  //|| !me.is_active() 
  || e.code == 'F11'
  || document.activeElement.id == 'name' 
  || document.activeElement.id == 'role' 
  || document.activeElement.id == 'chat-box') return;

  // Prevent the key's normal response.
  e.preventDefault();
  
  // Case structure for the different possible keys.
  switch(e.code) {

    // Right
    case 'KeyD': 
    case 'KeyL':
    case 'ArrowRight':

      // Only when the key state changes
      var value = e.type == 'keydown';
      if(key_right != value) {
        log('key_right', value);
        key_right = value;
        key_changed_send_update = true;
      }
      break;
    
    // Left
    case 'KeyA':
    case 'KeyJ': 
    case 'ArrowLeft':

      // Only when the key state changes
      var value = e.type == 'keydown';
      if(key_left != value) {
        log('key_left', value);
        key_left = value;
        key_changed_send_update = true;
      }
      break;
    
    // Forward
    case 'KeyW':
    case 'KeyI': 
    case 'ArrowUp':
      
      // Only when the key state changes
      var value = e.type == 'keydown';
      if(key_forward != value) {
        log('key_forward', value);
        key_forward = value;
        key_changed_send_update = true;
      }
      break;
    
    // Backward
    case 'KeyS':
    case 'KeyK': 
    case 'ArrowDown':
      
      // Only when the key state changes
      var value = e.type == 'keydown';
      if(key_back != value) {
        log('key_back', value);
        key_back = value;
        key_changed_send_update = true;
      }
      break;
    
    // Aim left
    case 'KeyQ': 
    case 'KeyU':

      // Only if it changes
      if(players[me.player_index].invert_x) {
        log('key_right_handed');
        players[me.player_index].invert_x = false;
        players[me.player_index].update_sprite_xysr();
        key_changed_send_update = true;
      }
      break;
    
    // Aim right
    case 'KeyE':
    case 'KeyO':
      
      // Only if it changes
      if(!players[me.player_index].invert_x) {
        log('key_left_handed');
        players[me.player_index].invert_x = true;
        players[me.player_index].update_sprite_xysr();
        key_changed_send_update = true;
      }
      break;
      
    case 'Space': // JACK: REALLY WEIRD INTERACTION WITH UP AND LEFT ARROWS on Dell XPS 13 Linux
    case 'ShiftLeft':
    case 'ShiftRight':
      
      // Only if it changes
      var value = e.type == 'keydown';
      if(players[me.player_index].is_shooting != value) {
        log('players[me.player_index].is_shooting', value);
        players[me.player_index].is_shooting = value;
        key_changed_send_update = true;
      }

      // Reset consecutive hits with sploders if we're not shooting
      if(!players[me.player_index].is_shooting) players[me.player_index].gun.rounds_consecutive_hits = 0;
      break;
    
    default:
      log('Unbound key', e.code);
  
  } // End of case

} // End of event_key()
window.addEventListener('keydown', event_key.bind(window), true);
window.addEventListener('keyup',   event_key.bind(window), true);

// When we change someone's role
function event_role_onchange(e) {
  log('event_role_onchange()', e.target.id, e.target.selectedIndex, e.target.value);

  // Update the clients list
  state.clients[parseInt(e.target.id)].role = e.target.selectedIndex;

  // Send the clients request to the server
  log('  Sending client request to server...');
  if(state.clients) me.emit('clients', state.clients);
  else log('  ERROR event_role_onchange: state.clients does not exist!');
}

// When we change our name
function event_name_onchange(e) {
  log('event_name_onchange()', e.target.id, e.target.value);

  // Remember name.
  save_cookie('name', e.target.value);

  // Update the clients list
  state.clients[me.id].name = e.target.value;

  // Send the clients request to the server
  log('  Sending client request to server...');
  if(state.clients) me.emit('clients', state.clients);
  else log('  ERROR event_name_onchange: state.clients does not exist!');
}

function event_volume_onchange(e) {

  var v  = parseInt(html_volume.value)      *0.01*1.0;
  var vm = parseInt(html_volume_music.value)*0.01*1.0

  log('event_volume_onchange()', html_volume.value, v, vm);
  
  // Change the master volume
  Howler.volume(v);
  jukebox.set_volume(vm);

  // Remember the value
  save_cookie('volume',       html_volume.value);
  save_cookie('volume_music', html_volume_music.value);
}

function event_game_mode_onchange(e) {
  save_cookie('game_mode', document.getElementById('game_mode').value);
}

// Auto-adjusting app size to available space
function event_window_resize() {
  
  // Renderer must fit in either width or height

  // Fit width
  if(window.innerWidth/state.game_width < window.innerHeight/state.game_height) {
    renderer.resize(window.innerWidth, window.innerWidth*state.game_height/state.game_width);
    stage.scale.x = window.innerWidth/state.game_width;
    stage.scale.y = window.innerWidth/state.game_width;
  }

  // Fit height
  else {
    renderer.resize(window.innerHeight*state.game_width/state.game_height, window.innerHeight);
    stage.scale.x = window.innerHeight/state.game_height;
    stage.scale.y = window.innerHeight/state.game_height;
  }

  // Center it
  var left  = String(0.5*(window.innerWidth -renderer.width  ))+'px';
  var left2 = String(0.5*(window.innerWidth -renderer.width)+7)+'px';
  var top   = String(0.5*(window.innerHeight-renderer.height ))+'px';
  html_gameboard .style.left = left;
  html_score     .style.left = left2;
  html_multiplier.style.left = left2;
  html_gameboard .style.top  = top;
  html_score     .style.top  = top;
  html_multiplier.style.bottom = top;

  log('event_window_resize()', stage.scale.x, window.innerWidth);

  // Also adjust the chat size
}
window.addEventListener("resize",  event_window_resize);


/////////////////////////////////////////
// GAME LOOP CALLED EVERY 1/60 SECONDS //
/////////////////////////////////////////

// Calls the currently set "state" function, which handles the game's updates.
function GAME_LOOP(delta) {if(state.playing) play(delta);} 

// "Play" state means aliens are running around, players are running around, etc.
let game_loop_n = 0;
function play(delta) {

  // Used for printing log files (slowly), etc
  game_loop_n++;
  is_30 = game_loop_n % 30 == 0;
  
  // Reused variables
  var a, p, b, dx, dy, l, h, n, m, r, dr;

  // Explosions first
  explosions        .animate(delta);
  flashes_rifle     .animate(delta);
  splats_rifle      .animate(delta);
  chunkgroups_aliens.animate(delta); 
  chunkgroups_players.animate(delta);
  chunkgroups_health.animate(delta);
  chunkgroups_alien_droplets.animate(delta);
  chunkgroups_player_droplets.animate(delta);
  
  // Make the blinder fade exponentially (Taylor expansion = good enough)
  blinder.alpha *= 1.0-delta/(t_blinder*0.06);

  // Animate the "dying" situation
  if(me.is_active()) {
    if(players[me.player_index].is_enabled()) dying.alpha = 0.008*(100-players[me.player_index].health);
    else                                      dying.alpha = 0;
  }

  // Set my rotation velocity
  if(me.is_active()) {
    if      ( key_right && !key_left) players[me.player_index].vr = 1;
    else if (!key_right &&  key_left) players[me.player_index].vr = -1;
    else                              players[me.player_index].vr = 0;

    // Set my running v
    if      ( key_forward && !key_back) players[me.player_index].v =  1
    else if (!key_forward &&  key_back) players[me.player_index].v = -1;
    else                                players[me.player_index].v =  0;
  }
  
  // Calculate the steps taken by the barrels
  for(var i=0; i<items.items.barrel.length; i++) {
    b = items.items.barrel[i];

    // Calculate the step
    h = b.sum_all_pushes();
    if(h) [b.vx, b.vy] = h;
    else  [b.vx, b.vy] = [0,0];
    [b.vx, b.vy] = limit_vector_length(b.vx, b.vy, state.max_push*delta);

    // Move it
    b.x += b.vx * state.game_speed * delta;
    b.y += b.vy * state.game_speed * delta;
    b.update_sprite_xysr();
  }

  // Calculate steps to be taken by the players based on current environment
  for(var n=0; n<players.length; n++) { 

    // If the player is disabled, skip 'em
    if(players[n].is_disabled()) continue;
    
    // Ease coding
    p = players[n]; 

    // Do all the hit tests to get the initial velocity
    h = p.sum_all_pushes();
    if(h) [p.vx, p.vy] = h;
    else  [p.vx, p.vy] = [0,0];
    [p.vx, p.vy] = limit_vector_length(p.vx,p.vy,state.max_push*delta);
    
    // If we didn't get hit too much and the player is moving, add their velocity
    if(h && p.v) {
      
      // Calculate the velocity unit vector from walking
      p.vx +=  Math.sin(p.container.rotation) * p.v * p.max_v;
      p.vy += -Math.cos(p.container.rotation) * p.v * p.max_v;
    }

    // We always increment the texture if the player is trying to move
    if(p.v || p.vr) p.increment_texture_delayed();

    // Shoot and calculate the shot effects ASAP
    p.shoot();
    
  } // end of players loop

  // Get the active player indices
  alive_player_indices = [];
  for(var n=0; n<players.length; n++) if(players[n].is_enabled()) alive_player_indices.push(n);
  
  // Calculate steps to be taken by aliens based on current environment
  for(var n in aliens) {
    for(var m in aliens[n]) {

      // Skip this alien if it's disabled.
      if(aliens[n][m].is_disabled()) continue;
      
      // Local variables
      a = aliens[n][m];

      // Get the target player
      p = players[aliens[n][m].target_index];

      // Create coordinates if this player doesn't exist (happened on a disconnect, or if target_index = -1)
      if(!p) p = {'x':state.game_width*0.5, 'y':state.game_height*0.5} 
      
      // Distance to player and angle
      dx = p.x - a.x;
      dy = p.y - a.y;
      l = Math.sqrt(dx*dx+dy*dy);
      r = get_angle(dx,dy);
    
      // Do all the hit tests to get the initial velocity
      h = a.sum_all_pushes(); // Will calculate damage
      if(h) [a.vx, a.vy] = h;
      else  [a.vx, a.vy] = [0,0];
      [a.vx, a.vy] = limit_vector_length(a.vx,a.vy,state.max_push*delta);
    
      // If we didn't get hit too much, add the alien velocity
      if(h) {
        // If everyone's dead, about face!
        if(!alive_player_indices.length) {
          r += Math.PI;
          dx = -dx;
          dy = -dy;
        }
        a.vx += (dx/l)*a.v;
        a.vy += (dy/l)*a.v;
      }

      // Shortest angular distance between current and target rotation
      dr = (r-a.r+3*Math.PI) % (2*Math.PI) - Math.PI;

      // Exponential angle convergence
      a.r += dr*0.1;
      
      // Always moving; no need to increment texture if just simulating.
      a.increment_texture_delayed();
    }
  } // end of aliens loop


  // Now propagate everything forward by delta.

  // Propagate players
  for(var n=0; n<players.length; n++) {

    // If the player is disabled, skip them
    if(players[n].is_disabled()) continue;
    
    // Ease coding
    p = players[n];

    // Update the player rotation and position
    p.r += p.vr * p.max_vr * state.game_speed * delta;
    p.x += p.vx            * state.game_speed * delta;
    p.y += p.vy            * state.game_speed * delta;

    // Hard walls around the game board.
    if(p.x < p.radius)             p.x = p.radius;
    if(p.y < p.radius)             p.y = p.radius;
    if(p.x > state.game_width -p.radius) p.x = state.game_width-p.radius;
    if(p.y > state.game_height-p.radius) p.y = state.game_height-p.radius;
    
    // Update the graphics
    p.update_sprite_xysr();
  }

  // Propagate aliens
  for(var n in aliens) {
    for(var m in aliens[n]) {
      
      // If this alien is disabled, skip it.
      if(aliens[n][m].is_disabled()) continue;

      // Ease coding
      a = aliens[n][m];
      
      // Move it
      a.x += a.vx * state.game_speed * delta;
      a.y += a.vy * state.game_speed * delta;
      a.update_sprite_xysr();
    }
  }
      

  // Respawn alien
  respawn_alien();


  // OTHER ANIMATIONS
  items.animate();


  // SCORE MULTIPLIER VISUALS & AUDIO

  // Get the faded kill multiplier, server_time+offset=local time,  tau
  var r = state.kill_rate * fader_smooth(t_last_kill, state.t_kill_rate_lifetime); 
  
  // Update the score
  html_score.innerHTML = state.score.toFixed(0);

  // Update the value
  html_multiplier.innerHTML = Math.max(1,r).toFixed(0)+' x';
  
  // Update the visuals
  var r = (r-1)*0.3;
  r = Math.min(1, r); 
  r = Math.max(0, r);
  html_multiplier.style.opacity = r*0.5; // rgb_to_ox(r*0.02, 0, 0);
  
  // Send just the player update for keyboard stuff
  if(key_changed_send_update && me.is_active()) {
    players[me.player_index].send_full_packet();
    key_changed_send_update = false;
  }

  // STUNNED VISUALS

  // If I'm playing
  if(me.player_index>=0) {

    // If I'm still alive.
    if(players[me.player_index].is_enabled()) {
      
      stunned *= 1.0-delta/(400*0.06);
      if(stunned < 0.1) stunned = 0;
      stage.x = stunned*2*(Math.random()-0.5)*stage.scale.x;
      stage.y = stunned*2*(Math.random()-0.5)*stage.scale.y;
      
      // Don't shift the dying visual
      dying.x = -stage.x/stage.scale.x;
      dying.y = -stage.y/stage.scale.y;
    }
    
    // No shaking after the final pop.
    else {
      stage.x = 0;
      stage.y = 0;
      dying.x = 0;
      dying.y = 0;
    }
  }

  ///////////////////////////////
  // NETWORK STUFF
  ///////////////////////////////

  // Send all pending alien hit and kill packets that have accumulated
  // Make sure to do this *AFTER* the shoot() processes above, so that the full update
  // doesn't come before the shoot/death updates and prevent others from seeing a death or explosion.
  if(alien_kill_packets.length) {
    log('Sending_k', alien_kill_packets.length);
    me.emit('k',  alien_kill_packets);
    alien_kill_packets.length = 0;
  }
  if(hit_thing_packets.length) {
    log('Sending_ah', hit_thing_packets.length);
    me.emit('ah', hit_thing_packets);
    hit_thing_packets.length = 0;
  }

  // Send a full update every so often (also resets the clock)
  // Only do this if we're still playing. Othwerise, let the other player take care of it so 
  // they don't have my jitters on their screen.
  // Also, do this AFTER sending all other updates, like alien deaths, so that the "disabled" doesn't come before the "die"
  if((Date.now() - t_last_update > state.t_update_delay) && me.is_active()) send_full_update();

} // end of play()













// Updates the client information in the GUI
function rebuild_client_table() {
  log('Sending client info to gui...');

  // Clear out the clients table
  var clients_table = document.getElementById('clients');
  clients_table.innerHTML = '';

  // Loop over the supplied clients
  for(var id in state.clients) {
    var c = state.clients[id];
    log('  ', c.id, c.name, c.role);

    // Get the "safe" name
    var name = html_encode(c.name);
    if(id == me.id) save_cookie('name', name);

    // Create the row for this client
    if(id != me.id) var row = clients_table.insertRow(-1);
    else            var row = clients_table.insertRow(0);
    var cell_name = row.insertCell(0);
    var cell_role = row.insertCell(1);

    // If it's me, the name should be editable, otherwise, not
    if(id == me.id) cell_name.innerHTML = '<input id="name" onchange="event_name_onchange(event)" value="'+name+'" />';
    else            cell_name.innerHTML = name;

    // Now create the role selector
    var s = document.createElement("select");
    s.id  = String(id); 

    //Create and append the options
    for (var i in state.role_names) {
        var o = document.createElement("option");
        o.value = state.role_names[i];
        o.text  = state.role_names[i];
        s.appendChild(o);
    }

    // Set the role
    s.selectedIndex = c.role;

    // Bind the change event
    s.onchange = event_role_onchange

    // Finally, append it to the role cell
    cell_role.appendChild(s);
    
  } // End of loop over clients

} // End of rebuild_client_table()


// Rebuilds the stage based on current state object
function clear_and_rebuild_stage() {
  log('Clearing and rebuilding the stage...');

  // We're about to delete everything we interact with, so, disable that.
  me.ready_for_play = false;
  
  ////////////////////////////////////
  // CLEAR STAGE AND ADD CHARACTERS //
  ////////////////////////////////////
  log('  Clearing stage & adding new characters');
  while(stage.children.length > 0) stage.removeChild(stage.children[0]);

  // Create the floor texture.
  floor_texture = PIXI.RenderTexture.create({width:state.game_width*1.1, height:state.game_height*1.1});

  // Create a sprite that will display this texture
  floor_sprite  = new PIXI.Sprite(floor_texture);
  floor_sprite.anchor.set(0.5, 0.5);
  floor_sprite.x = state.game_width*0.55;
  floor_sprite.y = state.game_height*0.55;

  // Add the floor sprite to my stage.
  stage.addChild(floor_sprite);

  // splats
  splat = new Chunk('aliens/splat.png', false, true); // used just to paint when droplets hit.

  // Player droplets on top
  chunkgroups_player_droplets = new ChunkGroups(500, {
    'soldier/droplet.png': [0,0],
  }, null, splat, // These chunks spawn no droplets, and paint the floor with splats
  true,           // Defer adding to the stage to put them on top.
  0xFF2222);      // Tint for droplets and splats

  // Droplets and splats
  chunkgroups_alien_droplets = new ChunkGroups(500, {
    'aliens/droplet.png': [0,0],
  }, null, splat, // These chunks spawn no droplets, and paint the floor with splats
  false);         // Do not defer adding to the stage to put them on top.

  // Chunks on floor, under feet
  chunkgroups_aliens = new ChunkGroups(500, {
    'aliens/chunk_foot1.png':[-14,10],
    'aliens/chunk_foot2.png':[14,10],
    'aliens/chunk_torso.png':[0,10],
    'aliens/chunk_arm1.png':[-25,0], 
    'aliens/chunk_arm2.png':[25,0], 
    'aliens/chunk_head.png':[0,-5],
  }, chunkgroups_alien_droplets, false); 

  // Chunks for players on alien chunks.
  chunkgroups_players = new ChunkGroups(4, {
    'soldier/chunk_foot1.png':      [-15,0],
    'soldier/chunk_foot2.png':      [ 15,0],
    'soldier/chunk_torso.png':      [  0,10],
    'soldier/chunk_arm1.png':       [-28,0],
    'soldier/chunk_arm2.png':       [ 19,3],
    'soldier/chunk_shoulder1.png':  [-20,10],
    'soldier/chunk_shoulder2.png':  [ 20,10],
    'soldier/chunk_head.png':       [ 0, 5],
  }, chunkgroups_player_droplets, false);

  // Item chunks
  chunkgroups_health = new ChunkGroups(100, {
    'items/health_chunk1.png':[-17,5],
    'items/health_chunk2.png':[-10,-7],
    'items/health_chunk3.png':[1,-12],
    'items/health_chunk4.png':[17,2],
    'items/health_chunk5.png':[10,-8],
    'items/health_chunk6.png':[10,8],
    'items/health_chunk7.png':[0,10],
  }); // No sauce, no defer add.

  // Also clear out our own memory (garbage collection will hopefully take care of the rest)
  aliens.length  = 0;
  players.length = 0;
  all_things.length=0;

  // Items in between chunks and aliens/players
  items = new Items();

  // Players on the bottom of the pile :)
  for(var n=0; n<player_colors.length; n++) {
    
    // Add the player objects (not packets)
    players.push(new Player([
      ['soldier_bottom1.png', 'soldier_bottom2.png', 'soldier_bottom3.png', 'soldier_bottom2.png'],
      ['soldier_top1.png', 'soldier_top2.png', 'soldier_top3.png', 'soldier_top2.png'],
    ], "soldier/", 0.5));

    // Set the animation speed
    players[n].t_texture_delay = 150;

    // Set the colors appropriately (gun is layer 1, so don't tint that)
    for(var i=0; i<players[n].sprites.length; i++) players[n].sprites[i].tint = player_colors[n];

    // Keep track of indices
    players[n].player_index = n;
    players[n].alien_index  = -1;

    players[n].stats = {
      'sauce':    0,
      'hits':     0,
      'shots':    0,
      'personal': 0,
      'aim':      0,
      'wasted_health' : 0,
      'wasted_rounds' : 0,
    }

  } // End of loop over player color list

  
  // Rifle splats and flashes between people and aliens
  splats_rifle  = new Flashes(40, 'weapons/rifle_splat.png', 500);
  flashes_rifle = new Flashes(20, 'weapons/rifle_flash.png', 100);

  // All aliens on top of players. :)
  for(var n=0; n<player_colors.length; n++) {
  
    // Add the aliens associated with player n
    aliens.push([]);
    for(var m=0; m<state.aliens_per_player; m++) {

      // Add the alien (only one layer); paths, root_path
      aliens[n].push(new Alien([
        ['walk1.png', 'walk2.png', 'walk3.png', 'walk2.png'],
      ], "aliens/", 1, 0)); 

      // Remember the indices for self-lookup later.
      aliens[n][m].player_index = n;
      aliens[n][m].target_index = n;
      aliens[n][m].alien_index  = m;
  
    } // end of add aliens

  } // end of add characters (all disabled by default)

  // PLayer droplets on top.
  chunkgroups_player_droplets.add_to_stage();

  // Dying layer
  dying = new PIXI.Sprite(resources[image_root_path+'tunnel_vision.png'].texture);
  dying.scale.x = state.game_width /dying.texture.width;
  dying.scale.y = state.game_height/dying.texture.height;
  dying.alpha = 0;
  stage.addChild(dying);

  // Blinding layer
  blinder = new PIXI.Graphics();
  blinder.beginFill(0x000000);
  blinder.drawRect(-state.game_width, -state.game_height, 3*state.game_width, 3*state.game_height);
  blinder.endFill(0x000000);
  blinder.alpha = 0.0;
  stage.addChild(blinder);
  
  // Explosions on top
  explosions = new Explosions(50);

  ////////////////////////////////////
  // POSITION AND ENABLE CHARACTERS //
  ////////////////////////////////////
  log('  Positioning and enabling characters')

  // Loop over the active players
  for(var n in state.players) { if (state.players[n]) {
    log('    Active player', n);
    
    // Transfer the information to 
    players[n].import_packet(state.players[n], true);

    // Loop over this player's aliens
    for(var m in state.aliens[n]) aliens[n][m].import_packet(state.aliens[n][m], true);

  }} // End of loop over activeplayers

  // Call the resize event so everything is scaled properly.
  event_window_resize();

  // Ready for keyboard input etc
  me.ready_for_play = true;
}











///////////////////////////////////
// NEW GAME!                     //
///////////////////////////////////

function new_game_clicked() {

  // To initiate a new game, all we need to do is update state, and send it to the server
  // We should only need to send the settings and player list. The rest will be handled by
  // the players (hopefully!) after receiving the new game from the server.

  // Note we only wish to assemble a request, and should not do anything to the state.
  // That will come from the server in a "state" packet.

  // Get the state header and update it according to the style
  var state_header = get_state_header();

  // Get the game mode
  var mode = document.getElementById('game_mode').value;

  // Set the defaults if not in custom mode.
  if(mode != 'custom') for(var key in state_defaults) state_header[key] = state_defaults[key];

  // The select objects associated with each client have an id set to the client's id number, e.g.
  // "37". Loop over the clients to figure out roles. Initially assume all are false.
  state_header.enabled_player_ids = [false, false, false, false];
  for(var id in state_header.clients) { 
    
    // Get the role index. 
    var role = document.getElementById(String(id)).selectedIndex;

    // Enabled player by replacing one of the falses with the client's id.
    if(role > 0) state_header.enabled_player_ids[role-1] = parseInt(id); 
  }

  // If no enabled players, assign them
  if(identical(state_header.enabled_player_ids, [false, false, false, false])) {
    var n = 0; 
    for(var id in state.clients) {
      state_header.enabled_player_ids[n] = parseInt(id);
      n++; if(n>=state_header.enabled_player_ids.length) break;
    }
  }

  // Count the number of enabled players
  n_enabled = 0;
  for(var i=0; i<state_header.enabled_player_ids.length; i++) if(state_header.enabled_player_ids[i]) n_enabled++;

  log('Enabled Players', state_header.enabled_player_ids, n_enabled);

  // Update it based on game style
  if(mode in game_modes)  // If it's a valid game mode (not 'custom')
    for(key in game_modes[mode]) // loop over the keys for this game mode
      state_header[key] = game_modes[mode][key];

  // Scale a few things based on the number of players
  state_header.aliens_per_player = Math.ceil(state_header.aliens_per_player / Math.sqrt(n_enabled));
  state_header.t_respawn_delay  *= Math.sqrt(n_enabled);

  // Send the request
  log( 'Sending_new_game', state_header);
  me     .emit('new_game', state_header);
}



////////////////////////
// Users & Chat
////////////////////////

function connect_to_server() {
  
  // Get name
  name = get_cookie_value('name');

  // Ask for the game state.
  log('Sending_hallo');
  me.emit('hallo', name);

  // Ready to receive packets now!
  me.ready_for_packets = true; 

  // Start the game loop
  app.ticker.add(delta => GAME_LOOP(delta));
}

// Tests
me.on('io', function(data) {
  log('Received_io', data);
});
me.on('socket', function(data) {
  log('Received_socket', data);
});
me.on('broadcast', function(data) {
  log('Received_broadcast', data);
});


// First thing to come back after 'hallo' is the game state
me.on('state', function(data) {
  var id = data[0];
  var server_state = data[1];
  log('Received_state', id, server_state);

  /*// Start the clock synchronization pings
  //log('  Starting synchronization...')
  me.sync_pings = [];        // Running list of {'ping', 'dt'}, where 'dt' is an estimate of 
                             // what we should subtract from local time to get server time.
  //emit_sync_ping();*/
  me.sync_dt = 0;            // Our best estimate of what to subtract from local time to get server time.
  
  // The server assigned me a unique id
  me.id = parseInt(id);

  // Make the server state our state
  state = server_state;

  // If the game is in progress, stop it.
  pause();

  // Send client information to the gui (rebuilds the HTML)
  rebuild_client_table();

  // Rebuild the aliens and players according to state.
  clear_and_rebuild_stage();

  // Now enable controls
  html_loader .style.visibility='hidden';
  html_settings.style.visibility='visible';

  // Now set the pause state
  html_settings.hidden = state.playing;

  // Special case: empty game
  if(state.aliens[0] == false) html_settings.hidden = false;
});




me.on('clients', function(clients) {
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_clients', clients);

  // Update the state
  state.clients = clients;

  // Rebuild gui.
  rebuild_client_table();
});

me.on('yabooted', function() {
  log('Received_yabooted');
  document.body.innerHTML = 'Booted. Reload page to rejoin.'
  document.body.style.color = 'white';
})

// New game command from server
me.on('new_game', function(server_state) {
  log('Received_new_game', server_state);

  // Kill the jukebox
  jukebox.stop();

  // Hide the stats
  stats_set_visible(false);
  
  // All we get initially is the enabled player ids and the state header (no packets).
  // Our job is to set up the player and alien we're responsible for and send an update.

  // Replace the state with the state header
  state = server_state; // This currently has no player or alien packets.
  state.game_over = false;

  // Rebuild the stage to specs; everything will be hidden by default
  clear_and_rebuild_stage();

  // Enable the players that are enabled and position them
  for(var n=0; n<state.enabled_player_ids.length; n++) {
    
    // If the player has an id (false by default), we should enable / position it.
    if(state.enabled_player_ids[n]) {

      // Store the player's controlling id for reference
      players[n].id = parseInt(state.enabled_player_ids[n]);

      // Enable the player (make visible)
      players[n].enable();
      alive_player_indices.push(n);
      participant_indices.push(n);

      // Position the player according to its radius and index
      var da = 2*Math.PI/players.length;             // Angle step
      var R  = players[n].radius / Math.sin(da*0.5); // Distance from middle 
      var a = 2*Math.PI*(n-0.5)/players.length;
      players[n].x   = state.game_width *0.5 + R*Math.sin(a);
      players[n].y   = state.game_height*0.5 - R*Math.cos(a);
      players[n].r   = a;
      players[n].invert_x = false;
      players[n].health = 100;
      players[n].update_sprite_xysr();
    
    } // End of player is enabled

  } // End of loop over enabled_player_ids

  // Get the local start time and reset pause count. Used for alien rate.
  t0_game  = Date.now();
  t_paused = 0;
  state.kill_rate = 0;
  state.kill_rate_max = 0;

  // Reset visuals
  stunned = 0;

  // If I'm an active player, set my index. -1 means not playing.
  me.player_index = state.enabled_player_ids.indexOf(me.id);

  // Reset my other responsibilities
  me.other_responsibilities.length = 0;

  // Hide the settings initially
  html_settings.hidden = true;
  sounds.unmute();

  // Respawn the first alien. This starts the chain of respawns...
  respawn_alien();

  // We need to send an initial update to the server, to populate the
  // server's state variable.
  send_full_update();
});

// Send all packets associated with one player
function send_full_update_n(n) {
  
  // List of packets; 0th element is player index
  let data = [n];

  // 1st element is the player data
  data.push(object_to_full_packet(players[n]));
  
  // rest are alien data
  for(var m in aliens[n]) data.push(object_to_alien_minipacket(aliens[n][m]));

  // Send everything
  log('Sending_fu', n, data.length);
  me.emit('fu', data);
}

// Send all packets we're responsible for to the server.
function send_full_update() {

  // Don't send updates if I'm not playing and have no other responsibilities
  if(!me.is_active() && !me.other_responsibilities.length) return; // just to be safe. Observers only receive packets.

  // Send my update
  send_full_update_n(me.player_index);

  // Send other responsibilities if this isn't just a player update
  for(var i=0; i<me.other_responsibilities.length; i++) send_full_update_n(me.other_responsibilities[i]);

  // Record the time if this is a full update
  t_last_update = Date.now();
  
} // End of send_full_update() 

// server sent a single-piece update [n,m,packet]
me.on('u', function(data) {

  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;

  // Used for other responsibilities
  var n = data[0];
  var m = data[1];
  log('Received_u', n, m);

  // If m=-1, it's just a player update
  if(m<0) {
    if(state.players[n]) state.players[n] = data[2];
    players[n].import_packet(data[2]);
  }

  // Otherwise it's an alien
  else {
    if(state.aliens && state.aliens[n]) state.aliens[n][m] = data[2];
    aliens[n][m].import_packet(data[2]);
  }
});

// server sent a multi-piece update [n, player_full_packet, alien_minipacket, alien_minipacket, ...]
me.on('fu', function(data) {

  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;

  // Used for other responsibilities
  var n = data[0];
  log('Received_fu', n, data.length);

  // Store the player state and import the packet
  if(players && players[n]) {
    state.players[n] = data[1];
    players[n].import_packet(data[1]);
  } 
  else log('ERROR: No player!', n);
  
  // Store the aliens in state and import the packets (if there are any)
  for(var m=2; m<data.length; m++) {
    if(aliens && aliens[n] && aliens[n][m-2]) {
      state.aliens[n][m-2] = data[m];
      aliens[n][m-2].import_alien_minipacket(data[m]);
    } 
    else log('ERROR: No alien!', n, m);
  }
  
}); 

// Playing state (pause / unpause)
me.on('playing', function(playing) {
  log('Received_playing', playing);

  // set the state
  state.playing = playing;

  // show the settings
  html_settings.hidden = playing;

  // Toggle the sound pause
  sounds.set_mute(!playing);
  jukebox.set_pause(!playing);

  // Send an update to everyone
  send_full_update();
});



function pause() {
  html_settings.hidden = false;
  update_pause();
}
function unpause() {
  html_settings.hidden = true;
  update_pause();
}
function toggle_pause() {

  html_settings.hidden = !html_settings.hidden;
  update_pause();
}
function is_paused()  {return !state.playing;}
function is_playing() {return  state.playing;}


// Toggle whether the game is paused
function update_pause() {

  // Toggle the state immediately locally
  state.playing = html_settings.hidden;

  // Record the time of the pause to add to all clocks
  if(!state.playing) t_last_pause = Date.now();
  else               t_paused    += Date.now() - t_last_pause;

  // Mute or unmute the audio
  sounds.set_mute(!state.playing);
  jukebox.set_pause(!state.playing);

  // Tell everyone to pause
  log('Sending_playing', state.playing);
  me.emit('playing', state.playing);
}



// Server sent a list of hit aliens = [[source_id, target_id, damage], ...]
// Also includes rifle_splat packets [-1, splat_x, splat_y, splat_scale, r, target_id]
// Also includes sploder round packets [-2, sploder_x, sploder_y, target_id];
me.on('ah', function(data) {

  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_ah', data.length); 

  // loop over the packets and update the healths, killing when necessary
  for(var i=0; i<data.length; i++) {
    log('  ah_i', data[i]);

    // Several types of packet, indexed by first element.

    // rifle hit [-1, splat_x, splat_y, splat_scale, r, target_id]
    if(data[i][0] == -1) { 

      // Get hit without damage
      // get_hit(source, allow_harm, ignore_delay, damage_scale, hit_packet)
      all_things[data[i][5]].get_hit(null, false, null, null, data[i]);
    }

    // Sploder hit [-2, sploder_x, sploder_y, target_id]
    else if(data[i][0] == -2) { 
      
      // Detonate the round
      explosions.detonate(
        data[i][1], data[i][2],               // Location
        state.rounds_sploder_radius,          // Radius
        false,                                // Do not harm aliens (damage & death from other packets)
        state.rounds_player_harm_scale,       // self harm reduction
        state.rounds_sploder_damage_scale,    // how much to scale the damage of the explosion
      );

      // Scare me if it's a big sploder
      //all_things[data[i][3]].scare_me();
    }

    // straight damage packet [source_id, target_id, damage]
    else { 

      var source = all_things[data[i][0]];
      var target = all_things[data[i][1]];
      var damage = data[i][2];
      
      // source, allow_damage, damage, send_packet
      target.take_damage_alien(source,true,damage,false);

      // Scare me if it's a big alien.
      //target.scare_me();
    }
  }
});

// Server confirmed kill data = [n,m,death_count,d,rd,kill_rate,score]
//                              [0,1,2,          3,4  5,        6    ]
me.on('k', function(data) {
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_k', data); 

  // Loop over the packets, killing the aliens as needed
  for(var i=2; i<data.length; i++) {

    // Unpacket
    var n  = data[i][0];
    var m  = data[i][1];
    var death_count = data[i][2];
    var d  = data[i][3];
    var rd = data[i][4];
    
    // Kill the alien
    if(aliens && aliens[n] && aliens[n][m]) aliens[n][m].die(false, death_count, d, rd);
  }

  // Update the score, kill rate, and time of kill
  state.score      = data[0];
  state.kill_rate  = data[1];
  state.kill_rate_max = Math.max(state.kill_rate, state.kill_rate_max);
  t_last_kill = Date.now(); // Server time of last kill

  // If the game is over, update the stats page
  if(state.game_over) stats_rebuild();

  // Trigger the jukebox
  if(!jukebox.is_playing) jukebox.play_next();
});

// Player gets hit, data = [player_index, packet, damage, dxi, dyi]
me.on('ph', function(data) {
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_ph', data);

  // Update the player
  if(state.players) state.players[data[0]] = data[1];
  players[data[0]].import_packet(data[1], true);

  // Launch sauce
  players[data[0]].launch_sauce(data[2],data[3],data[4]);
});

// Player dies, data = [player_index, packet, stats, chunks_coordinates, new_target_index]
me.on('pd', function(data) {
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_pd', data);

  var player_index       = data[0];
  var packet             = data[1];
  var stats              = data[2];
  var chunks_coordinates = data[3];
  var new_target_index   = data[4];

  // All the aliens attack someone new. Even if I die I need to know this for the simulation.
  if(new_target_index >= 0)

    // Loop over the supplied player's aliens, reassigning their target index
    for(var m=0; m<aliens[player_index].length; m++) aliens[player_index][m].target_index = new_target_index;

  // Only do something if it's not me.
  if(player_index != me.player_index) {

    // Update the player
    if(state.players[player_index]) state.players[player_index] = packet;
    if(players[player_index]) {

      // Import the packet
      players[player_index].import_packet(packet, true);

      // Die without telling others.
      if(players[player_index].is_enabled()) {
        if(chunks_coordinates) players[player_index].die_deterministic(chunks_coordinates);
        else                   players[player_index].die(false, 0, 100, Math.random()*2*Math.PI);
      }
      // Update the stats; will be null for disconnect
      players[player_index].stats = stats;
    }
  } // End of "not me."

  // If everyone's dead, show the stats
  for(var n=0; n<players.length; n++) if(players[n].is_enabled()) return;
  stats_rebuild();
  state.game_over = true;
  stats_set_visible(true);
});

// Server asks us to take over sending updates for a dropped client
me.on('take_over', function(n) {
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_take_over', n);

  // We are now responsible for sending packets on behalf of player index n.
  me.other_responsibilities.push(n);
});


// Incoming item (e.g. data=['health',x,y])
me.on('i', function(data) {
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_i', data[0]);

  // Respawn the item.
  items.respawn(data[0], data[1], data[2]);
});

// Incoming take confirmation [taker.index, item.index, other_data]
me.on('take', function(data) {
  
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_take', data);

  // Take it
  all_things[data[0]].take(all_things[data[1]], data[2]);
});

// Player says something (audio). data = [player_index, path, interrupt_same]
me.on('say', function(data) {
  // Bonk out if we're not ready.
  if(!me.ready_for_packets) return;
  log('Received_say', data);

  // Say it
  players[data[0]].say(data[1], data[2], data[3]);
})

// server sent a "chat"
me.on('chat', function(data) {
  var id = data[0];
  var message = data[1];
  log('Received_chat', id, message);

  // Safe-ify the name
  message = html_encode(message);
  
  // Get the name
  if(id == 0) var name = 'Server'
  else        var name = state.clients[id].name
  
  // messages div object
  m = $('#messages');

  // look for the tag "messages" in the html and append a <li> object to it
  m.append($('<li>').html('<b>' + name + ':</b> ' + message));

  // scroll to the bottom of the history
  m.animate({ scrollTop: m.prop("scrollHeight") - m.height() }, 'slow');

});

// We send a chat
function chat() {

  // Get the chat text and clear it
  var chat_box = document.getElementById('chat-box')
  var message  = html_encode(chat_box.value);
  chat_box.value = '';

  // Send a chat.
  log('Sending_chat', message);
  me.emit(    'chat', message);
}


////////////////////////
// Game Flow
////////////////////////

// Respawns an alien for player n
function respawn_alien_n(n) {
  log('respawn_alien_n', n);

  // Find an alien that is disabled
  for(var m in aliens[n]) {

    // If the alien is invisible (dead), bring it back!
    if(aliens[n][m].is_disabled()) {
      aliens[n][m].respawn();
      break; // Don't respawn them all!
    }
  } // If none are respawned, we're at the max. All good.
}

// Finds a dead alien and respawns it with new stats.
function respawn_alien() {
  
  // Butt out if I'm not an active player and have no other responsibilities
  if(!me.is_active() && !me.other_responsibilities.length) return;

  // Get now
  var t_now = Date.now();

  // Butt out if it's not time to respawn
  if(t_now < t_next_respawn) return;

  // Respawn for me and other responsibilities
  respawn_alien_n(me.player_index);
  for(var i in me.other_responsibilities) respawn_alien_n(me.other_responsibilities[i]);

  // Set the next respawn time.
  t_next_respawn = t_now + Math.max(50, // Min respawn delay is 50 ms.
    state.t_respawn_delay * Math.pow(0.5, (Date.now()-(t0_game+t_paused))/state.t_respawn_halflife));
} 




///////////////////////////////
// Stats
///////////////////////////////

// Shows the stats table.
function stats_set_visible(visible) {
  if(visible) html_stats.style.visibility='visible';
  else        html_stats.style.visibility='hidden';
}

// Clears out the stats table
function stats_clear() {
  var table = document.getElementById('stats-table');
  while(table.rows.length) table.deleteRow(0)
}

// Add a key-value pair to the stat table
function stats_append(key, value) {
  var table = document.getElementById('stats-table');

  // Append the row
  var row = table.insertRow();

  // Append the key td
  var td_key              = row.insertCell(); td_key  .className = 'stats-td-key'  ; td_key  .innerHTML = key;
  if(value) {var td_value = row.insertCell(); td_value.className = 'stats-td-value'; td_value.innerHTML = value;}
  else {
    td_key.colSpan=2;
    td_key.style.textAlign='center';
  }
}

// Build the stats table and show it
function stats_rebuild() {

  // Clear it out
  stats_clear();

  // Add the score
  var m = document.getElementById('game_mode');
  stats_append('<span style="font-family: digital-7; font-size: 3em; color: #5F5;">'+m.options[m.selectedIndex].text+'</span>');  
  var style='<span style="font-family: digital-7; font-size: 2em; color: #5F5;">'
  stats_append(style+'SCORE</span>', style+state.score.toFixed(0)+'</span>');
  stats_append(style+'Max harvest</span>', style+state.kill_rate_max.toFixed(0)+'</span>');
  stats_append('<br>');

  stats_append('<h1>Truths</h1>')

  // First get a list of just the active player stats
  var stats = [];
  for(var n=0; n<players.length; n++) 
    if(players[n].stats && 'name' in players[n].stats) stats.push(players[n].stats);

  // Now loop over the participating players, calculating relevant stats
  for(var n=0; n<stats.length; n++) {

    // Easier coding
    var s = stats[n];

    // No divide by zero.
    if(s.shots==0) s.shots=1;

    s['miss_percentage'] = 100*(1-s.hits/s.shots);
  }

  var sorted;

  // Now sort and list them
  
  var total_span = '<span style="color: #00FF00;">'

  sorted = sort_objects_by_key(stats, 'sauce', true);
  var list  = []; 
  var total = 0;
  for(var n=0; n<sorted.length; n++) {
    list.push(sorted[n].name + ' ('+(0.01*sorted[n].sauce).toFixed(2)+' humans worth)');
    total+=0.01*sorted[n].sauce;
  }
  if(list.length > 1) list.push(total_span + 'Total: ' + total.toFixed(2) + ' humans worth</span>');
  stats_append('Sauce production', list.join('<br>'));

  sorted = sort_objects_by_key(stats, 'wasted_health', true);
  var list  = []; 
  var total = 0;
  for(var n=0; n<sorted.length; n++) {
    if(sorted[n].wasted_health > 0) {
      list.push(sorted[n].name + ' ('+ sorted[n].wasted_health.toFixed(0) + ' health wasted)');
      total += sorted[n].wasted_health;
    }
  }
  if(list.length > 1) list.push(total_span + 'Total: ' + total.toFixed(0) + ' health wasted</span>');
  if     (list.length > 1) stats_append('Health dicks', list.join('<br>'));
  else if(list.length > 0) stats_append('Health dick',  list.join('<br>'));
  
  

  sorted = sort_objects_by_key(stats, 'wasted_rounds', true);
  if(sorted[0].wasted_rounds > 0) stats_append('Ammo dick', sorted[0].name + ' ('+ sorted[0].wasted_rounds.toFixed(0) +' rounds wasted)');

// These encourage bad behavior. :)
// 
//  sorted = sort_objects_by_key(stats, 'miss_percentage', true);
//  stats_append('Best at Missing', sorted[0].name + ' (missed '+ sorted[0].miss_percentage.toFixed(1) +'%)');
//
//
//  sorted = sort_objects_by_key(stats, 'aim', true);
//  stats_append('Most Precise Hits', sorted[0].name);
//
//  if(stats.length > 1) {
//    sorted = sort_objects_by_key(stats, 'personal', false);
//    stats_append("Distance weenie", sorted[0].name);
//  }

  // Categories for each type of death, sorted from best to worst.
  sorted = sort_objects_by_key(stats, 'chunk_distance', true);
  var dude_just_go_home1   = [];
  var dude_just_go_home2   = [];
  var good_deaths          = [];
  var solid_bs             = [];
  var acceptable_deaths    = [];
  var unacceptable_deaths  = [];
  var conscious_too_long   = [];
  var scale = 0.2;
  for(var n=0; n<sorted.length; n++) {
    if      (sorted[n].chunk_distance >= 650)    dude_just_go_home1 .push(sorted[n].name + ' ('+(scale*sorted[n].chunk_distance).toFixed(1)+' ft)');
    else if (sorted[n].chunk_distance >= 500)    good_deaths        .push(sorted[n].name + ' ('+(scale*sorted[n].chunk_distance).toFixed(1)+' ft)');
    else if (sorted[n].chunk_distance >= 400)    solid_bs           .push(sorted[n].name + ' ('+(scale*sorted[n].chunk_distance).toFixed(1)+' ft)');
    else if (sorted[n].chunk_distance >= 100)    acceptable_deaths  .push(sorted[n].name + ' ('+(scale*sorted[n].chunk_distance).toFixed(1)+' ft)');
    else if (sorted[n].chunk_distance >= 25)     unacceptable_deaths.push(sorted[n].name + ' ('+(scale*sorted[n].chunk_distance).toFixed(1)+' ft)');
    else if (sorted[n].chunk_distance >= 0.95*5) conscious_too_long .push(sorted[n].name + ' ('+(scale*sorted[n].chunk_distance).toFixed(1)+' ft)');
    else                                         dude_just_go_home2 .push(sorted[n].name + ' ('+(scale*sorted[n].chunk_distance).toFixed(1)+' ft)');
  }
  if(dude_just_go_home1 .length) stats_append('Dude, just go home.', dude_just_go_home1 .join('<br>'));
  if      (good_deaths.length == 1) stats_append('A good death', good_deaths.join('<br>'));
  else if (good_deaths.length)      stats_append('Good deaths',  good_deaths.join('<br>'));
  if     (solid_bs.length == 1)  stats_append("Solid B",    solid_bs.join('<br>'));
  else if(solid_bs.length)       stats_append("Solid B's",  solid_bs.join('<br>'));
  if(acceptable_deaths  .length) stats_append('Acceptable deaths',   acceptable_deaths  .join('<br>'));
  if(unacceptable_deaths.length) stats_append('Unacceptable deaths', unacceptable_deaths.join('<br>'));
  if(conscious_too_long .length) stats_append('<i>Fully</i> lucid while it was happening', conscious_too_long .join('<br>'));
  if(dude_just_go_home2 .length) stats_append('Dude, just go home.', dude_just_go_home2 .join('<br>'));
    
  // If you die too soon
  sorted = sort_objects_by_key(stats, 'score', false);
  var died_soon = [];
  for(var n=0; n<sorted.length; n++) if(sorted[n].score < 50) died_soon.push(sorted[n].name);
  if(died_soon.length) stats_append('Happens to everybody', died_soon.join('<br>'));
}




////////////////////////////////
// LOCAL STUFF
////////////////////////////////

// Local cookies
if(get_cookie_value('game_mode') != '') document.getElementById('game_mode').value = get_cookie_value('game_mode');


























// Back from sync-and-anticipate days.
// Sets a timer to update the sync time. Sets me.sync_t_last and sends a ping.
/*function emit_sync_ping() {
  setTimeout(function(){
    me.sync_t_last = Date.now();
    me.emit('t');
  }, state.t_sync_ping_delay);
}*/

// SIMULATION
  /*if(state.enable_extrapolation) {
    // At this point, player n's *aged* coordinates have been put into the system.
    // The best thing we could do is roll back *everyone's* coordinates to what they were
    // at that server time, then forward propagate, but this would require keeping a large 
    // recent history, or coding a "go backwards in time", keeping track of the times of 
    // everyone's key events. A cheaper method would be to take a snapshot of everyone's current
    // positions, propagate everyone forward, and then revert everyone except player n
    var t_sent = t_and_data[0];
    
    // Take a snapshot of everyone's positions, ignoring player n
    var snapshot = get_snapshot(n);

    // Propagate forward by the packet age
    simulate_play(Date.now()-me.sync_dt-t_sent);

    // Restore all but player n.
    restore_snapshot(snapshot); 

    // PROBLEM WITH ex, ey, er
  } */

  /*// Server time, response to sent 't'.
me.on('t', function(server_t) {
  log('Received_t', server_t);

  // Calculate ping and offset estimated from this ping.
  var t    = Date.now();
  var ping = t - me.sync_t_last;
  me.sync_pings.push({'ping': ping, 'dt': t - server_t - 0.5*ping});

  // Sort sync_pings by the ping value, increasing order.
  sort_objects_by_key(me.sync_pings, 'ping');
  
  // Get an average of the 1/5 shortest-pinged.
  var N = Math.ceil(me.sync_pings.length*0.2);
  var sum = 0;
  for(var n=0; n<N; n++) sum += me.sync_pings[n].dt;
  me.sync_dt = sum/N;
  log('  me.sync_dt =', me.sync_dt);

  // Send another ping (delayed) up to 100.
  if(me.sync_pings.length < 100) emit_sync_ping();
});*/

/* This produces a much less smooth result Players lurching around. Not an amazing user experience.
I opt instead to just have a delayed record sent with smoothing.

// HISTORY AND SIMULATION

// Take a snapshot of all the piece positions (packets)
// Returns [t_and_data,t_and_data,...] where each element is of the form
// sent by 'u'. Ignores non-enabled players, and the player of index ignore_n
function get_snapshot(ignore_n) {

  // Loop over all the active, non-ignored players
  snapshot = [];
  for(var n=0; n<players.length; n++) {if(ignore_n != n && players[n].is_enabled()) {
    snapshot.push(get_t_and_data(n));
  }}
  
  return snapshot;
}

// Runs play(delta) for delta=1/60 until t_duration has been simulated
function simulate_play(t_duration){
  
  // Run the simulated frames (0.06 frames / millisecond)
  for(var i=0; i<t_duration*0.06; i++) play(1, true);
}

*/
/*// Restores a snapshot
// Snapshot is of the form [data, data, ...], and does not
// need to include all players.
function restore_snapshot(snapshot) {

  for(var j=0; j<snapshot.length; j++) {

    // Get the 'fu' data. Element 0 is server time, 1 is player, ...
    var data = snapshot[j]; // data = [player,alien,alien,alien,...]
    var n    = data[0];     // n    = player_index
    
    // Store the player state and import the packet
    if(players && players[n]) {
      state.players[n] = data[1];
      players[n].import_packet(data[1]);
    } 
    else log('ERROR: No player!', n);
  
    // Store the aliens in state and import the packets (if there are any)
    for(var m=2; m<data.length; m++) 
      if(aliens && aliens[n] && aliens[n][m-2]) {
        state.aliens[n][m-2] = data[m];
        aliens[n][m-2].import_packet(data[m]);
      } 
      else log('ERROR: No alien!', n, m)
  
  } // End of loop over snapshot
}*/
