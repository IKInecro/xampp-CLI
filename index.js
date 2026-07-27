#!/usr/bin/env node

import { execSync, exec } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Constants ───
const XAMPP_PATHS = ['/opt/lampp','/Applications/XAMPP','/usr/local/lampp','/snap/xampp/current','/opt/xampp'];
const PID_FILES = {
  apache: ['var/run/httpd.pid','var/run/apache/httpd.pid','var/run/httpsd.pid','logs/httpd.pid'],
  mysql: ['var/run/mysql/mysql.pid','var/lib/mysql/mysql.pid','var/run/mysqld/mysqld.pid','var/mysql.pid'],
  ftp: ['var/run/proftpd.pid','var/proftpd.pid'],
};
const PORTS = { apache: '80', mysql: '3306', ftp: '21' };
const CHECK_PORTS = [
  { port: '80', service: 'Apache' },
  { port: '3306', service: 'MySQL' },
  { port: '443', service: 'HTTPS' },
  { port: '21', service: 'FTP' },
];

// ─── State ───
const state = {
  view: 'dashboard',
  svcMode: '',
  xamppDir: null,
  htdocsDir: null,
  lamppBin: null,
  projectSource: join(homedir(), 'jawa'),
  configPath: join(homedir(), '.config', 'xampp-cli.json'),
  status: { apache: false, mysql: false, ftp: false, xamppFound: false },
  logs: [],
  selProject: 0,
  selConfig: 0,
  settingsInput: '',
  settingsMode: '',
  dbList: [],
  dbSel: 0,
  vhostList: [],
  vhostSel: 0,
  portData: [],
  qkSel: 0,
  phpVersion: '?',
  sslInfo: null,
};

const MaxLog = 100;

// ─── ANSI ───
const R = '\x1b[0m';
const B = '\x1b[1m';
const A = '\x1b[38;5;166m';  // Accent (dark orange)
const C = '\x1b[38;5;208m';  // Orange
const G = '\x1b[38;5;48m';  // Green
const Rd = '\x1b[38;5;196m'; // Red
const Y = '\x1b[38;5;220m';  // Yellow
const W = '\x1b[38;5;255m'; // White
const Dim = '\x1b[38;5;245m';
const Hide = '\x1b[?25l';
const Show = '\x1b[?25h';
const Clr = '\x1b[2J';
const Home = '\x1b[H';

// ponytail: gradient colors applied per-line for visual depth
const ASC = [
  `${A}██╗  ██╗ █████╗ ███╗   ███╗██████╗ ██████╗                ${C}██████╗██╗     ██╗${R}`,
  `${A}╚██╗██╔╝██╔══██╗████╗ ████║██╔══██╗██╔══██╗              ${C}██╔════╝██║     ██║${R}`,
  `${A} ╚███╔╝ ███████║██╔████╔██║██████╔╝██████╔╝    █████╗    ${C}██║     ██║     ██║${R}`,
  `${C} ██╔██╗ ██╔══██║██║╚██╔╝██║██╔═══╝ ██╔═══╝     ╚════╝    ${A}██║     ██║     ██║${R}`,
  `${C}██╔╝ ██╗██║  ██║██║ ╚═╝ ██║██║     ██║                   ${A}╚██████╗███████╗██║${R}`,
  `${C}╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝                    ${A}╚═════╝╚══════╝╚═╝${R}`,
];

function strip(s) { return s.replace(/\x1b\[\d+(;\d+)*m/g, ''); }
function pad(s, w) { const v = strip(s); return s + ' '.repeat(Math.max(0, w - v.length)); }
function center(s, w) { const v = strip(s); const l = Math.max(0, w - v.length); return ' '.repeat(Math.floor(l/2)) + s + ' '.repeat(Math.ceil(l/2)); }

// ─── Config Persistence ───
function loadConfig() {
  try {
    const data = JSON.parse(readFileSync(state.configPath, 'utf8'));
    if (data.xamppDir && existsSync(data.xamppDir)) {
      state.xamppDir = data.xamppDir;
      state.htdocsDir = join(data.xamppDir, 'htdocs');
      state.lamppBin = join(data.xamppDir, 'lampp');
    }
    if (data.projectSource) state.projectSource = data.projectSource;
    if (data.svcMode) state.svcMode = data.svcMode;
  } catch {}
}

function saveConfig() {
  try {
    const dir = join(homedir(), '.config');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(state.configPath, JSON.stringify({
      xamppDir: state.xamppDir,
      projectSource: state.projectSource,
      htdocsDir: state.htdocsDir,
      svcMode: state.svcMode,
    }, null, 2));
  } catch {}
}

// ─── Logging ───
function addLog(text) {
  const t = new Date();
  const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
  state.logs.push({ ts, text });
  if (state.logs.length > MaxLog) state.logs.shift();
}

// ─── Detection ───
function detectServices() {
  try {
    for (const p of XAMPP_PATHS) {
      if (existsSync(p)) {
        state.svcMode = 'xampp';
        state.xamppDir = p;
        state.htdocsDir = join(p, 'htdocs');
        state.lamppBin = join(p, 'lampp');
        return true;
      }
    }
    if (existsSync('/lib/systemd/system/apache2.service')) {
      state.svcMode = 'systemd';
      state.htdocsDir = '/var/www/html';
      return true;
    }
  } catch {}
  return false;
}

function findPidFile(name) {
  if (!state.xamppDir) return null;
  for (const rel of (PID_FILES[name] || [])) {
    const full = join(state.xamppDir, rel);
    if (existsSync(full)) return full;
  }
  return null;
}

function xamppIsRunning(name) {
  const pidFile = findPidFile(name);
  if (!pidFile) return false;
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  } catch { return false; }
}

function systemdIsActive(name) {
  const svcName = { apache: 'apache2', mysql: 'mariadb', ftp: 'proftpd' }[name] || name;
  try {
    execSync(`systemctl is-active --quiet ${svcName}`, { timeout: 5000 });
    return true;
  } catch { return false; }
}

function isRunning(name) {
  if (state.svcMode === 'systemd') return systemdIsActive(name);
  return xamppIsRunning(name);
}

function refreshStatus() {
  if (state.svcMode === 'systemd') {
    state.status = {
      apache: systemdIsActive('apache'),
      mysql: systemdIsActive('mysql'),
      ftp: false,
      xamppFound: true,
    };
    return;
  }
  if (!state.xamppDir) { state.status = { apache: false, mysql: false, ftp: false, xamppFound: false }; return; }
  state.status = {
    apache: xamppIsRunning('apache'), mysql: xamppIsRunning('mysql'), ftp: xamppIsRunning('ftp'), xamppFound: true,
  };
}

function getIp() {
  try {
    const out = execSync('hostname -I 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
    const ip = out.split(/\s+/)[0];
    return ip || 'localhost';
  } catch { return 'localhost'; }
}

function execSvcAsync(action, service) {
  const cmds = [];
  if (state.svcMode === 'systemd') {
    const svcName = service ? { apache: 'apache2', mysql: 'mariadb', ftp: 'proftpd' }[service] || service : null;
    if (svcName) {
      cmds.push(`sudo systemctl ${action} ${svcName}`);
    } else {
      cmds.push(`sudo systemctl ${action} apache2`, `sudo systemctl ${action} mariadb`);
    }
  } else {
    const svc = service ? { apache: 'apache', mysql: 'mysql', ftp: 'proftpd' }[service] : null;
    if (svc) {
      const acts = {
        start: `start${svc === 'proftpd' ? 'proftpd' : svc}`,
        stop: `stop${svc === 'proftpd' ? 'proftpd' : svc}`,
        restart: `restart${svc === 'proftpd' ? 'proftpd' : svc}`,
      };
      cmds.push(`sudo ${state.lamppBin} ${acts[action] || action}`);
    } else {
      cmds.push(`sudo ${state.lamppBin} ${action}`);
    }
  }

  let done = 0;
  let failed = false;
  for (const cmd of cmds) {
    exec(cmd, { timeout: 30000 }, (err) => {
      done++;
      if (err) {
        failed = true;
        addLog(`${action} ${service || 'unknown'} failed: ${err.message.slice(0, 60)}`);
      }
      if (done === cmds.length) {
        if (!failed) {
          addLog(`${action} ${service || 'all'} succeeded`);
        }
        refreshStatus();
        if (action === 'start' && !failed) {
          const ip = getIp();
          if (!service || service === 'apache') {
            addLog(`Apache → http://${ip}/  http://${ip}/phpmyadmin`);
            const projects = getHtdocsProjects();
            for (const p of projects) {
              addLog(`  → http://${ip}/${p}`);
            }
          }
          if (!service || service === 'mysql') {
            addLog(`MySQL port 3306  user: marco / root`);
          }
        }
        render();
      }
    });
  }
  addLog(`${action} ${service || 'services'}...`);
  refreshStatus();
  render();
}

function svc(action, service) {
  execSvcAsync(action, service);
}

// ─── Projects ───
function getSourceProjects() {
  if (!existsSync(state.projectSource)) return [];
  try {
    return readdirSync(state.projectSource).filter(f => {
      const full = join(state.projectSource, f);
      return statSync(full).isDirectory() && !f.startsWith('.');
    });
  } catch { return []; }
}

function getHtdocsProjects() {
  if (!state.htdocsDir || !existsSync(state.htdocsDir)) return [];
  try {
    return readdirSync(state.htdocsDir).filter(f => {
      const full = join(state.htdocsDir, f);
      const s = statSync(full);
      return (s.isDirectory() || s.isSymbolicLink()) && !f.startsWith('.');
    });
  } catch { return []; }
}

function doCopyProject(name) {
  if (!state.htdocsDir) return 'HTDOCS_DIR not set';
  const src = join(state.projectSource, name);
  const dest = join(state.htdocsDir, name);
  if (!existsSync(src)) return `Folder ${name} not found`;
  if (existsSync(dest)) return `${name} already exists in htdocs`;
  try {
    const sudoPrefix = state.svcMode === 'systemd' ? 'sudo ' : '';
    execSync(`${sudoPrefix}cp -r "${src}" "${dest}"`, { timeout: 30000 });
    addLog(`Copy ${name} → htdocs`); return `✓ ${name} copied`;
  } catch (e) { return `Failed: ${e.message}`; }
}

function doLinkProject(name) {
  if (!state.htdocsDir) return 'HTDOCS_DIR not set';
  const src = join(state.projectSource, name);
  const dest = join(state.htdocsDir, name);
  if (!existsSync(src)) return `Folder ${name} not found`;
  if (existsSync(dest)) return `${name} already exists in htdocs`;
  try {
    const sudoPrefix = state.svcMode === 'systemd' ? 'sudo ' : '';
    execSync(`${sudoPrefix}ln -s "${src}" "${dest}"`, { timeout: 30000 });
    addLog(`Symlink ${name} → htdocs`); return `✓ ${name} linked`;
  } catch (e) { return `Failed: ${e.message}`; }
}

function doRemoveProject(name) {
  if (!state.htdocsDir) return 'HTDOCS_DIR not set';
  const dest = join(state.htdocsDir, name);
  if (!existsSync(dest)) return `${name} not in htdocs`;
  try {
    const sudoPrefix = state.svcMode === 'systemd' ? 'sudo ' : '';
    execSync(`${sudoPrefix}rm -rf "${dest}"`, { timeout: 30000 });
    addLog(`Remove ${name} from htdocs`); return `✓ ${name} removed`;
  } catch (e) { return `Failed: ${e.message}`; }
}

// ─── Feature Helpers ───

function getPhpVersion() {
  try {
    const out = execSync('php -v 2>/dev/null | head -1', { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/PHP\s+([\d.]+)/);
    return m ? m[1] : '?';
  } catch { return '?'; }
}

function getSslInfo() {
  if (!state.xamppDir) return { exists: false };
  const certPath = join(state.xamppDir, 'etc/ssl.crt/server.crt');
  if (!existsSync(certPath)) return { exists: false };
  try {
    const out = execSync(`openssl x509 -in "${certPath}" -noout -enddate 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/notAfter=(.*)/);
    return { exists: true, expiry: m ? m[1].trim() : '?' };
  } catch { return { exists: true, expiry: '?' }; }
}

function getDatabases() {
  try {
    const out = execSync('mysql -e "SHOW DATABASES" 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
    return out.split('\n').slice(1).filter(Boolean).map(d => d.trim()).filter(d => d !== 'performance_schema' && d !== 'information_schema');
  } catch { return []; }
}

function getDbSize(name) {
  try {
    const out = execSync(`mysql -e "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) FROM information_schema.tables WHERE table_schema='${name}'" 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
    const size = out.trim().split('\n')[1];
    return size ? `${size} MB` : '?';
  } catch { return '?'; }
}

function getVhosts() {
  const confPaths = [];
  if (state.xamppDir) {
    confPaths.push(join(state.xamppDir, 'etc/extra/httpd-vhosts.conf'));
    confPaths.push(join(state.xamppDir, 'etc/httpd.conf'));
  }
  if (state.svcMode === 'systemd') {
    confPaths.push('/etc/apache2/sites-enabled/*');
  }
  const entries = [];
  for (const cp of confPaths) {
    if (!existsSync(cp)) continue;
    try {
      const content = readFileSync(cp, 'utf8');
      const lines = content.split('\n');
      let current = null;
      for (const line of lines) {
        const t = line.trim();
        if (t === '<VirtualHost *:80>' || t.startsWith('<VirtualHost')) {
          current = { domain: '', root: '', enabled: true, file: cp };
        } else if (current && t.startsWith('</VirtualHost>')) {
          if (current.domain) entries.push(current);
          current = null;
        } else if (current) {
          const dm = t.match(/ServerName\s+(\S+)/);
          if (dm) current.domain = dm[1];
          const dr = t.match(/DocumentRoot\s+(\S+)/);
          if (dr) current.root = dr[1].replace(/"/g, '');
          if (t.startsWith('#') && !current.domain && !current.root) current.enabled = false;
        }
      }
    } catch {}
  }
  return entries.length > 0 ? entries : [{ domain: 'localhost', root: state.htdocsDir || '/', enabled: true, file: 'default' }];
}

function checkPort(port) {
  try {
    const out = execSync(`ss -tlnp 2>/dev/null | grep ":${port} "`, { encoding: 'utf8', timeout: 5000 });
    const pid = (out.match(/pid=(\d+)/) || [])[1];
    const proc = (out.match(/users:\(\("([^"]+)/) || [])[1] || 'unknown';
    return { used: true, pid: pid || '-', process: proc };
  } catch { return { used: false, pid: '-', process: '-' }; }
}



// ─── Panel Renderers ───

function pane(title, lines, w) {
  const r = [];
  const t = title ? `━ ${title} ` : '';
  const tl = strip(t).length;
  r.push(`${C}┏${t}${'━'.repeat(Math.max(1, w - tl - 2))}┓${R}`);
  for (const l of lines) {
    const cl = strip(l).length;
    r.push(`${C}┃${R} ${l}${' '.repeat(Math.max(0, w - cl - 3))}${C}┃${R}`);
  }
  r.push(`${C}┗${'━'.repeat(w - 2)}┛${R}`);
  return r;
}

function sideBySide(left, right, lw, rw, gap) {
  const h = Math.max(left.length, right.length);
  const r = [];
  for (let i = 0; i < h; i++) {
    const l = left[i] || ' '.repeat(lw);
    const rp = right[i] || ' '.repeat(rw);
    r.push(pad(l, lw) + ' '.repeat(gap) + pad(rp, rw));
  }
  return r;
}

function renderDashboard() {
  const cols = Math.max(60, process.stdout.columns || 80);
  const rows = Math.max(18, process.stdout.rows || 24);

  const out = [];

  // ── Top margin ──
  for (let i = 0; i < Math.min(3, Math.floor(rows * 0.1)); i++) out.push('');

  // ── Header ──
  for (let i = 0; i < ASC.length; i++) {
    const line = ASC[i];
    const w = strip(line).length;
    const padAmt = Math.max(0, Math.floor((cols - w) / 2));
    out.push(' '.repeat(padAmt) + line);
  }
  out.push(Dim + '━'.repeat(cols) + R);

  // ── Status Bar ──
  const modeLabel = state.svcMode === 'systemd' ? 'systemd' : state.svcMode === 'xampp' ? 'XAMPP' : 'none';
  const ip = getIp();
  const statusLine = `${C}◉${R} ${B}${W}${modeLabel}${R}  ${Dim}|${R}  ${C}◉${R} ${Dim}${ip}${R}  ${Dim}|${R}  ${C}◉${R} ${Dim}PHP ${state.phpVersion}${R}`;
  out.push(statusLine);
  out.push(Dim + '━'.repeat(cols) + R);

  // ── Compute panel widths ──
  let leftW = Math.floor(cols * 0.42);
  let rightW = cols - leftW - 2;
  if (leftW < 28) { leftW = 28; rightW = cols - leftW - 2; }
  if (rightW < 30) { rightW = 30; leftW = cols - rightW - 2; }

  // ── Services Panel ──
  const s = state.status;
  const svcContent = [];
  const svcDefs = [
    { name: 'Apache', key: 'apache', port: '80' },
    { name: 'MySQL',  key: 'mysql',  port: '3306' },
    { name: 'FTP',    key: 'ftp',    port: '21' },
  ];
  if (s.xamppFound) {
    for (const sv of svcDefs) {
      const run = s[sv.key];
      const icon = run ? `${G}●${R}` : `${Rd}○${R}`;
      const lbl = run ? `${G}Running${R}` : `${Rd}Stopped${R}`;
      svcContent.push(`${icon}  ${B}${sv.name}${R}  ${lbl}  ${Dim}:${sv.port}${R}`);
    }
    svcContent.push(`${G}●${R}  PHP ${state.phpVersion}`);
    const ssl = state.sslInfo;
    if (ssl && ssl.exists) {
      svcContent.push(`${G}●${R}  SSL ${Dim}(${ssl.expiry || '?'})${R}`);
    } else {
      svcContent.push(`${Rd}○${R}  SSL ${Dim}no cert${R}`);
    }
  } else {
    svcContent.push(`${Y}⚠ XAMPP not detected${R}`);
    svcContent.push(`${Dim}Press [S] to set path${R}`);
    svcContent.push('');
  }
  const svcPane = pane('SERVICES', svcContent, leftW);

  // ── Projects Panel ──
  const htdProjs = getHtdocsProjects();
  const projContent = [];
  if (state.htdocsDir) {
    projContent.push(`${B}htdocs:${R} ${Dim}${state.htdocsDir}${R}`);
    if (htdProjs.length > 0) {
      const maxShow = Math.min(htdProjs.length, rightW > 40 ? 12 : 6);
      const shown = htdProjs.slice(0, maxShow);
      for (const p of shown) {
        projContent.push(`  ${C}${p}${R}`);
      }
      if (htdProjs.length > maxShow) {
        projContent.push(`  ${Dim}... +${htdProjs.length - maxShow} more${R}`);
      }
    } else {
      projContent.push(`  ${Dim}(empty)${R}`);
    }
  } else {
    projContent.push(`${Dim}htdocs not configured${R}`);
    projContent.push(`${Dim}Press [S] to set up${R}`);
    projContent.push('');
  }
  const projPane = pane('PROJECTS', projContent, rightW);

  // ── Combine side by side ──
  const maxH = Math.max(svcPane.length, projPane.length, 3);
  for (let i = 0; i < maxH; i++) {
    const l = svcPane[i] || ' '.repeat(leftW);
    const r = projPane[i] || ' '.repeat(rightW);
    out.push(pad(l, leftW) + '  ' + pad(r, rightW));
  }

  // ── Log Panel ──
  out.push(A + '━'.repeat(cols) + R);
  const logH = Math.max(2, Math.floor((rows - out.length - 5) * 0.85));
  const logContent = [];
  const recent = state.logs.slice(-(logH - 2));
  for (const l of recent) {
    logContent.push(`${Dim}${l.ts}${R} ${l.text}`);
  }
  for (let i = logContent.length; i < logH - 2; i++) logContent.push('');
  if (state.logs.length === 0) {
    logContent.length = 0;
    for (let i = 0; i < logH - 2; i++) logContent.push(`${Dim}No logs yet. Press [1-9].${R}`);
  }
  const logPane = pane('LOGS', logContent, cols);
  out.push(...logPane.slice(0, logPane.length));

  // ── Controls ──
  out.push(A + '━'.repeat(cols) + R);
  const ctrl1 = `${C} 1${R}Start ${C}2${R}Stop ${C}3${R}Apache ${C}4${R}StopAp ${C}5${R}MySQL ${C}6${R}StopMy ${C}7${R}RstAp ${C}8${R}RstMy ${C}9${R}Rst`;
  const ctrl2 = `${C} P${R}Proj ${C}L${R}Logs ${C}C${R}Conf ${C}S${R}Set ${C}D${R}DB ${C}H${R}VHost ${C}K${R}Port ${C}O${R}Open ${C}R${R}Ref ${C}Q${R}Quit`;
  out.push(` ${Dim}⎡${R} ${ctrl1} ${Dim}⎤${R}`);
  out.push(` ${Dim}⎣${R} ${ctrl2} ${Dim}⎦${R}`);

  // ── Output ──
  process.stdout.write(Clr + Home);
  for (let i = 0; i < rows; i++) {
    if (i < out.length) {
      const line = out[i];
      const vw = strip(line).length;
      process.stdout.write(line + ' '.repeat(Math.max(0, cols - vw)) + '\n');
    } else {
      process.stdout.write(' '.repeat(cols) + '\n');
    }
  }
}

// ─── Sub-Views ───

function renderProjectsView() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const srcProjs = getSourceProjects();
  const htdProjs = getHtdocsProjects();
  const h = rows - 4;

  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}PROJECT MANAGEMENT${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  // Source projects list
  out.push(` ${B}${C}SOURCE:${R} ${Dim}${state.projectSource}${R}`);
  for (let i = 0; i < srcProjs.length; i++) {
    const sel = state.selProject === i ? `${C}►${R}` : ' ';
    out.push(` ${sel} ${i + 1}. ${srcProjs[i]}`);
  }
  if (srcProjs.length === 0) out.push(` ${Dim}(empty)${R}`);
  out.push('');

  // htdocs projects
  out.push(` ${B}${C}HTDOCS:${R} ${Dim}${state.htdocsDir || '(not set)'}${R}`);
  for (const p of htdProjs) {
    const inSrc = srcProjs.includes(p);
    out.push(`   ${inSrc ? G : Dim}${inSrc ? '✓' : '○'}${R} ${p}`);
  }
  if (htdProjs.length === 0) out.push(` ${Dim}(empty)${R}`);
  out.push('');

  out.push(` ${Dim}[Enter]${R} Copy selected  ${Dim}[L]${R} Symlink  ${Dim}[R]${R} Remove from htdocs  ${Dim}[S]${R} Set source  ${Dim}[↑↓]${R} Navigate  ${Dim}[Esc]${R} Back${R}`);

  const outStr = out.slice(0, h).join('\n');
  process.stdout.write(Clr + Home + outStr);
}

function renderLogsView() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const h = rows - 3;

  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}LOG VIEWER${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  const start = Math.max(0, state.logs.length - h + 4);
  for (let i = start; i < state.logs.length; i++) {
    const l = state.logs[i];
    out.push(` ${Dim}${l.ts}${R} ${l.text}`);
  }
  if (state.logs.length === 0) out.push(` ${Dim}No logs.${R}`);

  const outStr = out.slice(0, h).join('\n');
  process.stdout.write(Clr + Home + outStr);
}

function getConfigFiles() {
  if (state.svcMode === 'systemd') {
    return [
      { name: 'apache2.conf', path: '/etc/apache2/apache2.conf' },
      { name: 'ports.conf', path: '/etc/apache2/ports.conf' },
      { name: 'my.cnf', path: '/etc/mysql/my.cnf' },
      { name: 'php.ini', path: '/etc/php/8.2/apache2/php.ini' },
    ];
  }
  return [
    { name: 'php.ini', path: join(state.xamppDir || '', 'etc/php.ini') },
    { name: 'httpd.conf', path: join(state.xamppDir || '', 'etc/httpd.conf') },
    { name: 'my.cnf', path: join(state.xamppDir || '', 'etc/my.cnf') },
    { name: 'proftpd.conf', path: join(state.xamppDir || '', 'etc/proftpd.conf') },
    { name: 'phpMyAdmin config', path: join(state.xamppDir || '', 'phpmyadmin/config.inc.php') },
  ];
}

function renderConfigView() {
  const cols = process.stdout.columns || 80;
  const configFiles = getConfigFiles();

  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}QUICK CONFIG${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  for (let i = 0; i < configFiles.length; i++) {
    const f = configFiles[i];
    const exists = f.path && existsSync(f.path);
    const icon = exists ? `${G}●${R}` : `${Rd}○${R}`;
    const sel = state.selConfig === i ? `${C}►${R}` : ' ';
    out.push(` ${sel} ${icon} ${i + 1}. ${f.name}  ${Dim}${exists ? f.path : '(not found)'}${R}`);
  }
  out.push('');
  out.push(` ${Dim}[Enter]${R} Edit (nano)  ${Dim}[↑↓]${R} Navigate  ${Dim}[Esc]${R} Back${R}`);

  process.stdout.write(Clr + Home + out.join('\n'));
}

function renderSettingsView() {
  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}SETTINGS${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  const modeLabel = state.svcMode === 'systemd' ? 'Systemd (Apache2/MariaDB)' : state.svcMode === 'xampp' ? `XAMPP (${state.xamppDir})` : 'Not detected';

  // Info panel
  out.push(` ${Dim}┏━ Info ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  const infoPad = (v) => ' '.repeat(Math.max(0, 51 - strip(v).length));
  out.push(` ${Dim}┃${R}  ${B}Mode:${R}   ${A}${modeLabel}${infoPad(modeLabel)}${Dim}┃${R}`);
  const htd = state.htdocsDir || '(not set)';
  out.push(` ${Dim}┃${R}  ${B}htdocs:${R} ${Dim}${htd}${infoPad(htd)}${Dim}┃${R}`);
  const src = state.projectSource;
  out.push(` ${Dim}┃${R}  ${B}Source:${R} ${A}${src}${infoPad(src)}${Dim}┃${R}`);
  out.push(` ${Dim}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  // Menu items
  const items = [
    { key: '1', label: 'Set XAMPP path', desc: 'Change XAMPP installation directory' },
    { key: '2', label: 'Set Source folder', desc: 'Change project source directory' },
    { key: '3', label: 'Auto-detect services', desc: 'Scan for XAMPP or systemd services' },
  ];
  for (const item of items) {
    out.push(` ${C}[${item.key}]${R} ${B}${item.label}${R}`);
    out.push(` ${Dim}   ${item.desc}${R}`);
    out.push('');
  }

  // Input mode
  if (state.settingsMode === 'xampp' || state.settingsMode === 'source') {
    const prompt = state.settingsMode === 'xampp' ? 'XAMPP path' : 'Source folder';
    const inputPre = `  Enter new ${prompt}:`;
    out.push(` ${A}┏━ Input ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
    out.push(` ${A}┃${R} ${C}${inputPre}${' '.repeat(Math.max(0, 60 - strip(inputPre).length))}${A}┃${R}`);
    out.push(` ${A}┃${R}  ${W}${state.settingsInput}${C}█${' '.repeat(Math.max(0, 58 - strip(state.settingsInput).length))}${A}┃${R}`);
    out.push(` ${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
    out.push('');
    out.push(` ${Dim}[Enter]${R} Confirm  ${Dim}[Esc]${R} Cancel`);
  } else {
    out.push(` ${Dim}[Esc]${R} Back to dashboard`);
  }

  process.stdout.write(Clr + Home + out.join('\n'));
}

// ─── New Feature Renderers ───

function renderDbView() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}DATABASE BROWSER${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  if (state.dbList.length === 0) {
    out.push(` ${Dim}No databases found (MySQL running?).${R}`);
  } else {
    for (let i = 0; i < state.dbList.length; i++) {
      const db = state.dbList[i];
      const sel = state.dbSel === i ? `${C}►${R}` : ' ';
      const size = getDbSize(db);
      out.push(` ${sel} ${G}●${R} ${i + 1}. ${db}  ${Dim}${size}${R}`);
    }
  }
  out.push('');
  out.push(` ${Dim}[Enter]${R} phpMyAdmin URL  ${Dim}[R]${R} Refresh  ${Dim}[Esc]${R} Back${R}`);

  process.stdout.write(Clr + Home + out.join('\n'));
}

function renderVhostView() {
  const cols = process.stdout.columns || 80;

  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}VIRTUAL HOST MANAGER${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  if (state.vhostList.length === 0) {
    out.push(` ${Dim}No virtual hosts configured.${R}`);
  } else {
    for (let i = 0; i < state.vhostList.length; i++) {
      const v = state.vhostList[i];
      const sel = state.vhostSel === i ? `${C}►${R}` : ' ';
      const icon = v.enabled ? `${G}●${R}` : `${Rd}○${R}`;
      out.push(` ${sel} ${icon} ${i + 1}. ${v.domain}  ${Dim}${v.root}${R}`);
    }
  }
  out.push('');
  out.push(` ${Dim}[A]${R} Add  ${Dim}[D]${R} Delete  ${Dim}[R]${R} Reload Apache  ${Dim}[Esc]${R} Back${R}`);

  process.stdout.write(Clr + Home + out.join('\n'));
}

function renderPortView() {
  const cols = process.stdout.columns || 80;

  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}PORT CHECKER${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  out.push(` ${B}${C}Port   Service   Status    PID   Process${R}`);
  out.push(` ${Dim}${'─'.repeat(Math.min(cols - 2, 50))}${R}`);
  for (const p of state.portData) {
    const icon = p.used ? `${G}● IN USE${R}` : `${Rd}○ FREE${R}`;
    out.push(` ${p.port.padEnd(6)} ${p.service.padEnd(10)} ${pad(icon, 14)} ${p.pid.padEnd(6)} ${Dim}${p.process}${R}`);
  }
  out.push('');
  out.push(` ${Dim}[R]${R} Refresh  ${Dim}[Esc]${R} Back${R}`);

  process.stdout.write(Clr + Home + out.join('\n'));
}

const QUICK_OPEN_ITEMS = [
  { label: 'phpMyAdmin', desc: 'http://localhost/phpmyadmin', type: 'url' },
  { label: 'htdocs folder', desc: null, type: 'path' },
  { label: 'XAMPP folder', desc: null, type: 'path' },
  { label: 'Apache access log', desc: null, type: 'path' },
  { label: 'MySQL error log', desc: null, type: 'path' },
  { label: 'PHP info page', desc: 'http://localhost/', type: 'url' },
];

function renderQuickOpenView() {
  const cols = process.stdout.columns || 80;

  const out = [];
  out.push(`${A}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${R}`);
  out.push(`${A}┃${R}  ${B}${W}QUICK OPEN${R}  ${Dim}(Esc back)${R}`);
  out.push(`${A}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${R}`);
  out.push('');

  for (let i = 0; i < QUICK_OPEN_ITEMS.length; i++) {
    const item = QUICK_OPEN_ITEMS[i];
    const sel = state.qkSel === i ? `${C}►${R}` : ' ';
    const path = item.type === 'url' ? item.desc : getQuickPath(item.label);
    out.push(` ${sel} ${i + 1}. ${item.label}  ${Dim}${path}${R}`);
  }
  out.push('');
  out.push(` ${Dim}[Enter]${R} Open  ${Dim}[Esc]${R} Back${R}`);

  process.stdout.write(Clr + Home + out.join('\n'));
}

function getQuickPath(label) {
  if (label === 'htdocs folder') return state.htdocsDir || '(not set)';
  if (label === 'XAMPP folder') return state.xamppDir || '(not set)';
  if (label === 'Apache access log') return state.xamppDir ? join(state.xamppDir, 'logs/access_log') : '/var/log/apache2/access.log';
  if (label === 'MySQL error log') return state.xamppDir ? join(state.xamppDir, 'logs/mysql_error.log') : '/var/log/mysql/error.log';
  return '';
}



// ─── Render ───
function render() {
  switch (state.view) {
    case 'dashboard': renderDashboard(); break;
    case 'projects': renderProjectsView(); break;
    case 'logs': renderLogsView(); break;
    case 'config': renderConfigView(); break;
    case 'settings': renderSettingsView(); break;
    case 'db': renderDbView(); break;
    case 'vhost': renderVhostView(); break;
    case 'port': renderPortView(); break;
    case 'qkopen': renderQuickOpenView(); break;

    default: renderDashboard();
  }
}

// ─── Input ───
function onKey(data) {
  const key = data.toString();

  if (key === '\u0003') { cleanup(); process.exit(0); }

  if (state.view === 'dashboard') {
    switch (key) {
      case 'q': case 'Q': cleanup(); process.exit(0); break;
      case '1': svc('start', null); break;
      case '2': svc('stop', null); break;
      case '3': svc('start', 'apache'); break;
      case '4': svc('stop', 'apache'); break;
      case '5': svc('start', 'mysql'); break;
      case '6': svc('stop', 'mysql'); break;
      case '7': svc('restart', 'apache'); break;
      case '8': svc('restart', 'mysql'); break;
      case '9':
        svc('restart', 'apache');
        svc('restart', 'mysql');
        break;
      case 'p': case 'P':
        state.view = 'projects';
        state.selProject = 0;
        render();
        break;
      case 'l': case 'L':
        state.view = 'logs';
        render();
        break;
      case 'c': case 'C':
        state.view = 'config';
        state.selConfig = 0;
        render();
        break;
      case 's': case 'S':
        state.view = 'settings';
        state.settingsMode = '';
        state.settingsInput = '';
        render();
        break;
      case 'r': case 'R':
        refreshStatus();
        state.phpVersion = getPhpVersion();
        state.sslInfo = getSslInfo();
        addLog('Status refreshed');
        render();
        break;
      case 'd': case 'D':
        state.view = 'db';
        state.dbList = getDatabases();
        state.dbSel = 0;
        render();
        break;
      case 'h': case 'H':
        state.view = 'vhost';
        state.vhostList = getVhosts();
        state.vhostSel = 0;
        render();
        break;
      case 'k': case 'K':
        state.view = 'port';
        state.portData = CHECK_PORTS.map(p => {
          const result = checkPort(p.port);
          return { ...p, ...result };
        });
        render();
        break;
      case 'o': case 'O':
        state.view = 'qkopen';
        state.qkSel = 0;
        render();
        break;

    }
    return;
  }

  // ── Projects View ──
  if (state.view === 'projects') {
    const srcProjs = getSourceProjects();
    const htdProjs = getHtdocsProjects();
    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      refreshStatus();
      render();
      return;
    }
    if (key === '\u001b[A') {
      state.selProject = Math.max(0, state.selProject - 1);
      render();
      return;
    }
    if (key === '\u001b[B') {
      state.selProject = Math.min(srcProjs.length - 1, state.selProject + 1);
      render();
      return;
    }
    if (key === '\r' || key === '\n') {
      const name = srcProjs[state.selProject];
      if (name) {
        const msg = doCopyProject(name);
        addLog(msg);
      }
      render();
      return;
    }
    if (key === 'l' || key === 'L') {
      const name = srcProjs[state.selProject];
      if (name) {
        const msg = doLinkProject(name);
        addLog(msg);
      }
      render();
      return;
    }
    if (key === 'r' || key === 'R') {
      const name = srcProjs[state.selProject];
      if (name && htdProjs.includes(name)) {
        const msg = doRemoveProject(name);
        addLog(msg);
      } else if (name) {
        addLog(`${name} not in htdocs`);
      } else {
        addLog('No project to remove');
      }
      render();
      return;
    }
    if (key === 's' || key === 'S') {
      state.view = 'settings';
      state.settingsMode = 'source';
      state.settingsInput = state.projectSource;
      render();
      return;
    }
    return;
  }

  // ── Logs View ──
  if (state.view === 'logs') {
    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      render();
      return;
    }
    return;
  }

  // ── Config View ──
  if (state.view === 'config') {
    const configFiles = getConfigFiles();
    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      render();
      return;
    }
    if (key === '\u001b[A') {
      state.selConfig = Math.max(0, state.selConfig - 1);
      render();
      return;
    }
    if (key === '\u001b[B') {
      state.selConfig = Math.min(configFiles.length - 1, state.selConfig + 1);
      render();
      return;
    }
    if (key === '\r' || key === '\n') {
      const f = configFiles[state.selConfig];
      if (f.path && existsSync(f.path)) {
        process.stdin.setRawMode(false);
        process.stdout.write(Show + Clr + Home);
        try { execSync(`nano "${f.path}"`, { stdio: 'inherit' }); }
        catch { try { execSync(`vi "${f.path}"`, { stdio: 'inherit' }); } catch {} }
        process.stdin.setRawMode(true);
        addLog(`Edited ${f.name}`);
      } else {
        addLog(`${f.name} not found`);
      }
      render();
      return;
    }
    return;
  }

  // ── Settings View ──
  if (state.view === 'settings') {
    if (state.settingsMode === 'xampp' || state.settingsMode === 'source') {
      if (key === '\u001b') {
        state.settingsMode = '';
        state.settingsInput = '';
        render();
        return;
      }
      if (key === '\r' || key === '\n') {
        const val = state.settingsInput.trim();
        if (val) {
          if (state.settingsMode === 'xampp') {
            if (existsSync(val)) {
              state.xamppDir = val;
              state.htdocsDir = join(val, 'htdocs');
              state.lamppBin = join(val, 'lampp');
              addLog(`XAMPP path → ${val}`);
              saveConfig();
              refreshStatus();
            } else {
              addLog(`Path not found: ${val}`);
            }
          } else if (state.settingsMode === 'source') {
            state.projectSource = val;
            saveConfig();
            addLog(`Source folder → ${val}`);
          }
        }
        state.settingsMode = '';
        state.settingsInput = '';
        render();
        return;
      }
      if (key === '\u007f') {
        state.settingsInput = state.settingsInput.slice(0, -1);
        render();
        return;
      }
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        state.settingsInput += key;
        render();
        return;
      }
      return;
    }

    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      render();
      return;
    }
    if (key === '1') {
      state.settingsMode = 'xampp';
      state.settingsInput = state.xamppDir || '/opt/lampp';
      render();
      return;
    }
    if (key === '2') {
      state.settingsMode = 'source';
      state.settingsInput = state.projectSource;
      render();
      return;
    }
    if (key === '3') {
      if (detectServices()) {
        const mode = state.svcMode === 'systemd' ? 'Apache2/MariaDB (systemd)' : `XAMPP (${state.xamppDir})`;
        addLog(`Detected: ${mode}`);
        saveConfig();
        refreshStatus();
      } else {
        addLog('No services detected');
      }
      render();
      return;
    }
    return;
  }

  // ── Database Browser ──
  if (state.view === 'db') {
    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      render();
      return;
    }
    if (key === '\u001b[A') {
      state.dbSel = Math.max(0, state.dbSel - 1);
      render();
      return;
    }
    if (key === '\u001b[B') {
      state.dbSel = Math.min(state.dbList.length - 1, state.dbSel + 1);
      render();
      return;
    }
    if (key === '\r' || key === '\n') {
      if (state.dbList[state.dbSel]) {
        addLog(`phpMyAdmin → http://localhost/phpmyadmin (db: ${state.dbList[state.dbSel]})`);
      }
      render();
      return;
    }
    if (key === 'r' || key === 'R') {
      state.dbList = getDatabases();
      render();
      return;
    }
    return;
  }

  // ── Virtual Host Manager ──
  if (state.view === 'vhost') {
    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      render();
      return;
    }
    if (key === '\u001b[A') {
      state.vhostSel = Math.max(0, state.vhostSel - 1);
      render();
      return;
    }
    if (key === '\u001b[B') {
      state.vhostSel = Math.min(state.vhostList.length - 1, state.vhostSel + 1);
      render();
      return;
    }
    if (key === 'a' || key === 'A') {
      addLog('VHost add: edit httpd-vhosts.conf manually via Config');
      render();
      return;
    }
    if (key === 'd' || key === 'D') {
      addLog('VHost delete: edit httpd-vhosts.conf manually via Config');
      render();
      return;
    }
    if (key === 'r' || key === 'R') {
      svc('restart', 'apache');
      return;
    }
    return;
  }

  // ── Port Checker ──
  if (state.view === 'port') {
    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      render();
      return;
    }
    if (key === 'r' || key === 'R') {
      state.portData = CHECK_PORTS.map(p => {
        const result = checkPort(p.port);
        return { ...p, ...result };
      });
      render();
      return;
    }
    return;
  }

  // ── Quick Open ──
  if (state.view === 'qkopen') {
    if (key === '\u001b' || key === 'q' || key === 'Q') {
      state.view = 'dashboard';
      render();
      return;
    }
    if (key === '\u001b[A') {
      state.qkSel = Math.max(0, state.qkSel - 1);
      render();
      return;
    }
    if (key === '\u001b[B') {
      state.qkSel = Math.min(QUICK_OPEN_ITEMS.length - 1, state.qkSel + 1);
      render();
      return;
    }
    if (key === '\r' || key === '\n') {
      const item = QUICK_OPEN_ITEMS[state.qkSel];
      if (item.type === 'url') {
        addLog(`Open browser → ${item.desc}`);
      } else {
        const path = getQuickPath(item.label);
        if (path && existsSync(path)) {
          addLog(`Path: ${path}`);
        } else {
          addLog(`Path not found: ${path}`);
        }
      }
      render();
      return;
    }
    return;
  }


}

// ─── Lifecycle ───
function attachInput() {
  if (!process.stdin.isTTY) {
    console.error('Terminal interaktif diperlukan');
    process.exit(1);
  }
  try { process.stdin.setRawMode(true); } catch {}
  process.stdin.resume();
  process.stdin.on('data', onKey);
}

function cleanup() {
  try { process.stdin.setRawMode(false); } catch {}
  process.stdout.write(Show + '\x1b[0m' + Clr + Home);
}

// ─── Main ───
function main() {
  process.on('uncaughtException', (e) => {
    cleanup();
    console.error('\nError:', e.message);
    process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    cleanup();
    console.error('\nError:', e.message);
    process.exit(1);
  });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('exit', cleanup);

  process.stdout.on('resize', () => render());

  loadConfig();
  detectServices();
  refreshStatus();
  state.phpVersion = getPhpVersion();
  state.sslInfo = getSslInfo();

  addLog(`XAMPP-CLI MNG started (mode: ${state.svcMode || 'none'})`);
  if (!state.svcMode) addLog('No services detected. [S]ettings to configure.');
  else if (state.svcMode === 'systemd') addLog('Apache2 + MariaDB detected via systemd');
  else addLog(`XAMPP detected at ${state.xamppDir}`);

  attachInput();
  render();
}

main();
