#!/usr/bin/env node

var fs = require('fs');
var path = require('path');
var net = require('net');
var child_process = require('child_process');
var readlineSync = require('readline-sync');
var ps = require('ps-node');


var CONFIG = {
    BINPATH: '/usr/sbin/openvpn',   // OpenVPN executable path
    CFGDIR: '/etc/openvpn/',       // Folder containning openvpn config files
    RUNDIR: '/tmp/ovpn-manager/',  // Folder containing runtime files and sockets
    PARAMS: '--management-client-user root --management-client-group root'
    // Custom parameters used to start openvpn
}

var rlOpts = {
    hideEchoBack: true
};


function usage(argument) {
    console.log('Usage: openvpn-manager.js [start|stop|status] [name] [gw]');
    process.exit(1);
}


function killOpenVPN() {

    ps.lookup({
        command: 'openvpn',
        arguments: 'openvpn-' + name,
        psargs: 'ux'
        }, function(err, resultList ) {
        if (err) {
            throw new Error( err );
        }

        resultList.forEach(function( proc ){
            if( proc ){
                console.error('killing stale proccess: ' + proc.pid);
                process.kill(proc.pid, 'SIGTERM');
            }
        });
    });
}


process.on('SIGINT', function () {
    console.log('Got SIGINT');
    killOpenVPN();
});


var gw_mode = process.argv[4];
var name = process.argv[3];
var cmd = process.argv[2];

var cfgFile, pidFile, scktFile;


// Check for root
if (process.getuid() !== 0) {
  console.error('This script must be run as root');
  process.exit(1);
}

// Check args
if ((process.argv.length < 4) || (process.argv[2].indexOf('-h') !== -1))
    usage();



// Build paths
cfgFile = path.join(CONFIG.CFGDIR, name + '.conf');
pidFile = path.join(CONFIG.RUNDIR, name + '-pid');
scktFile = path.join(CONFIG.RUNDIR, name + '-socket');


// Check if config file exists
try {
    fs.statSync(cfgFile)
} catch (e) {
    console.error('Config File for connection not found.');
    console.error('Exiting...');
    process.exit(2);
}

// Create runtime folder
try {
    fs.statSync(CONFIG.RUNDIR);
} catch (e) {
    try {
        fs.mkdirSync(CONFIG.RUNDIR, 0o700);
    } catch (e) {
        console.error('Error creating runtime folder.');
        console.error('Exiting...');
        process.exit(2);   
    }
}


// Parse CMD
switch (cmd) {
    case 'start':

        // Check if already running
        try {
            fs.statSync(pidFile);
            console.error('Aleady running');
            process.exit(1);
        } catch (e) {}

        // Build CMD and execut it
        var cmd = CONFIG.BINPATH;
        cmd += ' --cd ' + CONFIG.CFGDIR;
        cmd += ' --config ' + cfgFile;
        cmd += ' --daemon openvpn-' + name;
        cmd += ' --management ' + scktFile + ' unix';
        cmd += ' --management-up-down';
        cmd += ' --management-query-passwords --writepid ' + pidFile;

        // Check for gateway mode
        if (gw_mode)
            cmd += ' --redirect-gateway def1';

        // Run cmd & connect to the control socket
        var res = child_process.execSync(cmd);
        var client = net.connect({path: scktFile});

        client.on('data', function(data) {
            console.log(data.toString());

            // Request for certificate Password
            if (data.toString().indexOf(">PASSWORD:Need 'Private Key'") !== -1) {
                var password = readlineSync.question('Certificate password: ', rlOpts);
                console.log('');
                client.write('password "Private Key" ' + password + '\n');
            }

            // Request for user/password
            if (data.toString().indexOf(">PASSWORD:Need 'Auth' username/password") !== -1) {
                var username = readlineSync.question('Username: ');
                var password = readlineSync.question('Password: ', rlOpts);
                console.log('');
                client.write('username "Auth" ' + username + '\n');
                client.write('password "Auth" ' + password + '\n');
            }
            
            // Succesfully connected
            if (data.toString().indexOf('>UPDOWN:UP') !== -1) {
                client.end();
            }

            // Error
            if (data.toString().indexOf('ERROR: ') !== -1) {
                client.end();
            }

        });

        client.on('end', function() {
            killOpenVPN();
        });

        client.on('error', function() {
            console.log('Error connecting to control socket');
            process.exit(1);
        });

        break;

    case 'stop':
        try {
            var pid = parseInt(fs.readFileSync(pidFile).toString());
            process.kill(pid, 'SIGTERM');
            console.log('Seding SIGTERM to pid: ' + pid);
        } catch (e) {
            console.error('Could not find connection PID file');
        }

        try { fs.unlinkSync(pidFile); } catch (e) {}
        
        killOpenVPN();
        break;

    case 'status':
        var client = net.connect({path: scktFile}, function() {
            client.write('status\n');
        });

        client.on('data', function(data) {
            console.log(data.toString());
            client.end();
        });

        client.on('end', function() {
            process.exit(0);
        });

        client.on('error', function() {
            console.log('Error connecting to control socket');
            process.exit(1);
        });
        break;

    default:
        usage();
        break;
}

