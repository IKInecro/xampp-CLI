// Self-check for the systemd-mode fixes. Run: node test/systemd.test.js
import assert from 'assert';
import { existsSync } from 'fs';
import { findPhpIni, getConfigFiles, state, checkPort } from '../index.js';

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

t('findPhpIni points at an existing php.ini', () => {
  const p = findPhpIni();
  assert.ok(p, 'path is empty');
  assert.ok(existsSync(p), `${p} does not exist`);
});

t('findPhpIni prefers the newest php version dir', () => {
  const p = findPhpIni();
  const m = p.match(/\/etc\/php\/([\d.]+)\//);
  assert.ok(m, `unexpected path shape: ${p}`);
  const vers = ['8.5', '8.4', '8.3', '8.2'];
  const known = vers.find(v => m[1] === v);
  assert.ok(known, `unknown version ${m[1]}`);
  assert.equal(m[1], vers.find(v => existsSync(`/etc/php/${v}/apache2/php.ini`)), 'not the newest installed');
});

t('systemd config list has every real file', () => {
  state.svcMode = 'systemd';
  const files = getConfigFiles();
  assert.ok(files.length >= 5, 'expected phpMyAdmin config entry too');
  for (const f of files) assert.ok(existsSync(f.path), `${f.name} -> ${f.path} missing`);
});

t('systemd config list includes phpMyAdmin config', () => {
  state.svcMode = 'systemd';
  const names = getConfigFiles().map(f => f.name);
  assert.ok(names.includes('phpMyAdmin config'), 'phpMyAdmin config not listed');
});

t('xampp-mode config list still returns the XAMPP paths', () => {
  state.svcMode = 'xampp';
  state.xamppDir = '/opt/lampp';
  const files = getConfigFiles();
  assert.ok(files.some(f => f.path === '/opt/lampp/etc/php.ini'));
  assert.ok(files.some(f => f.path.includes('phpmyadmin')));
});

t('checkPort sees a listener with pid and process', () => {
  const r = checkPort('80');
  assert.ok(r.used, 'port 80 reported free');
  assert.notEqual(r.pid, '-', 'no pid resolved');
  assert.notEqual(r.process, '-', 'no process resolved');
});

t('checkPort reports a free port as unused', () => {
  const r = checkPort('21');
  assert.equal(r.used, false);
  assert.equal(r.pid, '-');
});

console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
