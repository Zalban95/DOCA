'use strict';

/**
 * Which network a machine is on, said the same way by the hub and by a client that looks from somewhere else
 * (docs/design/cast-reach.md §1.3, §6.2 `nearby_network`; shipped to doca-client as clients/node/nearby/network.js):
 * its private IPv4 subnet, the gateway's address and a short hash of the gateway's MAC — the router's card, the same
 * whoever asks on that network, and never the MAC itself. Two lookers with the same gateway hash are on one network:
 * their private addresses are the same things; otherwise 192.168.1.5 here and 192.168.1.5 there are two.
 */
const os = require('os');
const crypto = require('crypto');

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * The network in CIDR — `192.168.1.0/24`, never Node's `cidr`, which is the address with its prefix
 * (`192.168.1.212/24`): two machines on one network said two subnets, so `sameNetwork` without a gateway hash never
 * matched (found 2026-10-13 against DocaDesk and DocaMobile, which say the network).
 */
function subnetOf(address, cidr) {
  const prefix = Math.min(32, Math.max(0, Number(String(cidr || '').split('/')[1]) || 24));
  const n = address.split('.').reduce((x, o) => (x << 8) + Number(o), 0) >>> 0;
  const net = prefix ? (n & (0xffffffff << (32 - prefix))) >>> 0 : 0;
  return `${[24, 16, 8, 0].map(s => (net >>> s) & 255).join('.')}/${prefix}`;
}

/** This machine's first private IPv4 on a real interface, with its subnet in CIDR. */
function ownSubnet(ifs = os.networkInterfaces()) {
  const VIRTUAL = (() => { try { return require('./mdns').VIRTUAL; } catch { return /^(docker|br-|veth|virbr|vmnet|vbox|tailscale|utun|zt)/; } })();
  for (const [name, list] of Object.entries(ifs)) {
    if (VIRTUAL.test(name)) continue;
    const a = (list || []).find(x => x.family === 'IPv4' && !x.internal && PRIVATE_V4.test(x.address));
    if (a) return { iface: name, address: a.address, subnet: subnetOf(a.address, a.cidr), kind: /^(wl|wlan|wi-?fi|en0$|airport)/i.test(name) ? 'wifi' : 'ethernet' };
  }
  return null;
}

const hashMac = mac => (mac ? crypto.createHash('sha256').update(String(mac).toLowerCase()).digest('hex').slice(0, 12) : null);

/** {subnet, address, gateway, gatewayMacHash, kind, at}; `neighbours` is lan.js's reading when it was already taken. */
async function network({ neighbours = null, ifs } = {}) {
  const own = ownSubnet(ifs);
  let gw = null;
  try { gw = (neighbours || await require('./lan').neighbours()).find(n => n.gateway) || null; } catch { /* no table */ }
  return { subnet: own?.subnet || null, address: own?.address || null, gateway: gw?.ip || null, gatewayMacHash: hashMac(gw?.mac),
    kind: own?.kind || null, ssid: null, at: new Date().toISOString() };
}

/** Whether two readings are one network: the same router card, else (no MAC known) the same subnet and gateway. */
function sameNetwork(a, b) {
  if (!a || !b) return false;
  if (a.gatewayMacHash && b.gatewayMacHash) return a.gatewayMacHash === b.gatewayMacHash;
  return !!a.subnet && a.subnet === b.subnet && !!a.gateway && a.gateway === b.gateway;
}

module.exports = { network, sameNetwork, ownSubnet, hashMac, subnetOf };
