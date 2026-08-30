import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDetectOutput, suggestWatts } from '../src/scanner.js';

test('parse les caractéristiques SSH', () => {
  const specs = parseDetectOutput(`hostname raspberrypi\nos Debian GNU/Linux 13 (trixie)\nmodel Raspberry Pi 5 Model B Rev 1.0\narch aarch64\ncpucount 4\ncpumodel Cortex-A76\nmemtotal 8192000\ndisktotal 120000000\ndocker no\nsystemd yes\n`);
  assert.equal(specs.hostname, 'raspberrypi');
  assert.equal(specs.model, 'Raspberry Pi 5 Model B Rev 1.0');
  assert.equal(specs.cpu_count, 4);
  assert.equal(specs.has_docker, false);
  assert.equal(specs.has_systemd, true);
  assert.equal(specs.mem_total_bytes, 8192000 * 1024);
});

test('suggère une consommation adaptée au matériel', () => {
  assert.deepEqual(suggestWatts({ model: 'Raspberry Pi 5 Model B' }), { idle_w: 3, max_w: 12 });
  assert.deepEqual(suggestWatts({ model: 'NUC7PJYHN' }), { idle_w: 6, max_w: 35 });
  assert.deepEqual(suggestWatts({ virt: 'kvm' }), { idle_w: 2, max_w: 10 });
});
