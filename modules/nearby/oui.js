'use strict';

/**
 * Who made a network card, from the first three bytes of its address — a small subset of the IEEE registry, the makers
 * most often met on a home or office network, not the whole file (tens of thousands of rows nobody needs here). A
 * prefix not in it is "unknown maker"; an address with the locally-administered bit is a private (random) one, which
 * phones, tablets and laptops use to hide who made them — said as such, never guessed.
 */
const MAKERS = {
  Google: ['00:1A:11', '00:F6:20', '3C:5A:B4', '54:60:09', 'A4:77:33', 'F4:F5:D8', 'F4:F5:E8', 'D8:6C:63', '1C:F2:9A', '20:DF:B9', '48:D6:D5', 'F8:8F:CA'],
  Apple: ['00:03:93', '00:0A:95', '00:1B:63', '00:1E:C2', '00:25:00', '28:CF:E9', '3C:07:54', '40:6C:8F', '70:56:81', 'AC:BC:32', 'F0:18:98', 'D0:81:7A', 'BC:52:B7', 'A4:5E:60'],
  'Raspberry Pi': ['B8:27:EB', 'DC:A6:32', 'E4:5F:01', 'D8:3A:DD', '2C:CF:67', '28:CD:C1'],
  Espressif: ['24:0A:C4', '30:AE:A4', '84:0D:8E', 'A4:CF:12', '3C:71:BF', 'CC:50:E3', 'BC:DD:C2', '24:6F:28', '7C:9E:BD', 'EC:FA:BC', '8C:AA:B5', 'C4:4F:33'],
  Amazon: ['F0:27:2D', '74:C2:46', '44:65:0D', '68:37:E9', 'FC:65:DE', '84:D6:D0', '0C:47:C9', '40:B4:CD'],
  Sonos: ['00:0E:58', '5C:AA:FD', '94:9F:3E', '78:28:CA', 'B8:E9:37', '48:A6:B8'],
  'Philips Hue': ['00:17:88', 'EC:B5:FA'],
  'TP-Link': ['50:C7:BF', '98:DA:C4', '60:32:B1', '1C:3B:F3', 'B0:95:75', 'AC:84:C6', '14:EB:B6'],
  Ubiquiti: ['24:A4:3C', '44:D9:E7', '78:8A:20', 'FC:EC:DA', '80:2A:A8', 'F0:9F:C2', '74:83:C2'],
  AVM: ['3C:A6:2F', 'C8:0E:14', '24:65:11', '7C:FF:4D', '2C:91:AB', '38:10:D5'],
  Xiaomi: ['64:09:80', '78:11:DC', '28:6C:07', '50:EC:50', '7C:49:EB'],
  Brother: ['00:80:77'],
  VMware: ['00:50:56', '00:0C:29'],
  VirtualBox: ['08:00:27'],
  QEMU: ['52:54:00'],
};

const BY_PREFIX = new Map(Object.entries(MAKERS).flatMap(([who, ps]) => ps.map(p => [p, who])));

/** A MAC written any common way (dashes, single digits from macOS' arp) → `aa:bb:cc:dd:ee:ff`, or null. */
function normalize(mac) {
  const parts = String(mac || '').trim().split(/[:-]/);
  if (parts.length !== 6 || parts.some(p => !/^[0-9a-f]{1,2}$/i.test(p))) return null;
  return parts.map(p => p.padStart(2, '0').toLowerCase()).join(':');
}

/** The second bit of the first byte: set on addresses a device made up for itself. */
const isPrivate = mac => { const m = normalize(mac); return !!m && (parseInt(m.slice(0, 2), 16) & 2) === 2; };

/** Broadcast or multicast: never a device. */
const isGroup = mac => { const m = normalize(mac); return !m || (parseInt(m.slice(0, 2), 16) & 1) === 1 || m === '00:00:00:00:00:00'; };

/** {maker, private}: the maker's name, `null` with private true for a made-up address, `null` when not in the list. */
function vendor(mac) {
  const m = normalize(mac);
  if (!m) return { maker: null, private: false };
  if (isPrivate(m)) return { maker: null, private: true };
  return { maker: BY_PREFIX.get(m.slice(0, 8).toUpperCase()) || null, private: false };
}

module.exports = { vendor, normalize, isPrivate, isGroup, MAKERS };
