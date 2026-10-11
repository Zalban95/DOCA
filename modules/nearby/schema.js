'use strict';

/**
 * The declaration of prefs `nearby` (settings-schema.js reads it from here, beside the code it governs): which sources
 * Machines → Nearby looks with, and whether it looks by itself. Never proposable — every source scans the network or
 * the air around this machine, and that is the owner's to switch on — and all off on a new install.
 */
const src = what => ({ type: 'boolean', default: false, propose: false, hint: `Look for ${what} when Nearby scans. Off: never looked for.` });

module.exports = { is: 'local', home: 'device', on: 'host', note: 'what Machines → Nearby looks for around this machine, and how often (nearby/) — the owner\'s, never proposable',
  keys: {
    'sources.cast':          src('Cast devices (Chromecasts, Google and Nest speakers) by their mDNS announcement, or with catt'),
    'sources.mdns':          src('Bonjour / zeroconf services on the local network (AirPlay, printers, HomeKit, web pages, file shares, SSH)'),
    'sources.ssdp':          src('UPnP and DLNA devices (smart TVs, media players and servers, the router)'),
    'sources.lan':           src('the neighbours in this machine\'s ARP table, with their makers and names'),
    'sources.bluetooth':     src('Bluetooth devices, with an 8-second discovery'),
    'sources.homeassistant': src('the entities of the Home Assistant this hub is connected to'),
    'sources.tailscale':     src('the other machines on this hub\'s tailnet'),
    everyMin:                { type: 'integer', min: 0, max: 1440, default: 0, propose: false, hint: 'Scan by itself every this many minutes, with the sources that are on (each scan is a line in the activity log). 0: only when someone presses Scan or the agent asks.' },
  } };
