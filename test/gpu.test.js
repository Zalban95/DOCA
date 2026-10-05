'use strict';

// GPUs whoever made them (modules/gpu.js, TODO H1.4): the AMD and Apple readings parsed from what their tools
// print (samples written in their documented shape, not captured from a machine here — there is no AMD or Apple
// GPU on the hosts this is built on); a reading a tool does not give is null, never 0.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRocm, parseIoreg } = require('../modules/gpu');

test('rocm-smi\'s JSON becomes the sidebar\'s shape', () => {
  const out = JSON.stringify({
    card0: { 'Card series': 'Radeon RX 7900 XTX', 'Temperature (Sensor edge) (C)': '47.0', 'GPU use (%)': '12', 'VRAM Total Memory (B)': '25753026560',
      'VRAM Total Used Memory (B)': '1325400064', 'Average Graphics Package Power (W)': '38.0', 'Fan speed (%)': '20', 'sclk clock speed:': '(1950Mhz)' },
    system: { 'Driver version': '6.7.0' },
  });
  assert.deepEqual(parseRocm(out), [{ name: 'Radeon RX 7900 XTX', temp: 47, util: 12, memUsed: 1264, memTotal: 24560, powerDraw: 38, fan: 20, clockSm: 1950, vendor: 'amd', source: 'rocm-smi' }]);
  assert.equal(parseRocm('not json'), null);
});

test('ioreg\'s accelerator statistics give an Apple GPU its utilisation and the shared memory in use', () => {
  const out = `+-o AGXAcceleratorG14X  <class AGXAcceleratorG14X, id 0x1000004c1>
    {
      "model" = "Apple M2 Pro"
      "PerformanceStatistics" = {"In use system memory"=1073741824,"Device Utilization %"=23,"Renderer Utilization %"=21}
    }`;
  const [g] = parseIoreg(out, 32 * 1024 ** 3);
  assert.deepEqual(g, { name: 'Apple M2 Pro', temp: null, util: 23, memUsed: 1024, memTotal: 32768, unified: true, vendor: 'apple', source: 'ioreg' });
  assert.equal(parseIoreg('nothing here'), null);
});
