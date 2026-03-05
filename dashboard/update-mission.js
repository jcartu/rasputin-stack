#!/usr/bin/env node
/**
 * CLI to update missions.json programmatically
 * Usage:
 *   node update-mission.js add --name "Research X" --desc "..." --status active --progress 10 --eta "Feb 15"
 *   node update-mission.js task <mission-id> --add "Task name" --status active
 *   node update-mission.js progress <mission-id> <percent>
 *   node update-mission.js status <mission-id> <active|done|paused|planned>
 *   node update-mission.js remove <mission-id>
 */
const fs = require('fs');
const path = require('path');

const MISSIONS_FILE = path.join(__dirname, 'missions.json');

function load() {
  try { return JSON.parse(fs.readFileSync(MISSIONS_FILE, 'utf8')); }
  catch { return { updated: new Date().toISOString(), missions: [] }; }
}

function save(data) {
  data.updated = new Date().toISOString();
  fs.writeFileSync(MISSIONS_FILE, JSON.stringify(data, null, 2) + '\n');
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30);
}

const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd) {
  console.log('Usage: node update-mission.js <add|task|progress|status|remove> [args]');
  process.exit(1);
}

const data = load();

if (cmd === 'add') {
  const flags = {};
  for (let i = 1; i < args.length; i += 2) {
    if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i+1];
  }
  const mission = {
    id: flags.id || slugify(flags.name || 'mission'),
    name: flags.name || 'Unnamed Mission',
    status: flags.status || 'active',
    progress: parseInt(flags.progress || '0'),
    eta: flags.eta || 'TBD',
    desc: flags.desc || '',
    tasks: []
  };
  // Remove existing with same id
  data.missions = data.missions.filter(m => m.id !== mission.id);
  data.missions.unshift(mission); // newest first
  save(data);
  console.log(`✅ Added mission: ${mission.name} (${mission.id})`);

} else if (cmd === 'task') {
  const missionId = args[1];
  const m = data.missions.find(x => x.id === missionId);
  if (!m) { console.error(`Mission not found: ${missionId}`); process.exit(1); }
  const flags = {};
  for (let i = 2; i < args.length; i += 2) {
    if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i+1];
  }
  if (flags.add) {
    m.tasks.push({ name: flags.add, status: flags.status || 'active' });
    console.log(`✅ Added task to ${missionId}: ${flags.add}`);
  }
  if (flags.complete) {
    const t = m.tasks.find(t => t.name.toLowerCase().includes(flags.complete.toLowerCase()));
    if (t) { t.status = 'done'; console.log(`✅ Completed: ${t.name}`); }
  }
  save(data);

} else if (cmd === 'progress') {
  const m = data.missions.find(x => x.id === args[1]);
  if (!m) { console.error(`Mission not found: ${args[1]}`); process.exit(1); }
  m.progress = parseInt(args[2]);
  save(data);
  console.log(`✅ ${m.name} → ${m.progress}%`);

} else if (cmd === 'status') {
  const m = data.missions.find(x => x.id === args[1]);
  if (!m) { console.error(`Mission not found: ${args[1]}`); process.exit(1); }
  m.status = args[2];
  if (args[2] === 'done') m.progress = 100;
  save(data);
  console.log(`✅ ${m.name} → ${m.status}`);

} else if (cmd === 'remove') {
  data.missions = data.missions.filter(m => m.id !== args[1]);
  save(data);
  console.log(`✅ Removed: ${args[1]}`);

} else if (cmd === 'list') {
  data.missions.forEach(m => {
    const icon = {active:'🟢', done:'✅', paused:'⏸️', planned:'📋'}[m.status] || '⚪';
    console.log(`${icon} ${m.id.padEnd(20)} ${String(m.progress).padStart(3)}% ${m.name}`);
  });

} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
