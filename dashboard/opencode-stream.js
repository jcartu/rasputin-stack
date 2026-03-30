#!/usr/bin/env node
// OpenCode Stream Relay — Captures opencode process output and relays to dashboard
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class OpenCodeStreamRelay {
  constructor() {
    this.activeProcesses = new Map(); // pid → { proc, buffer, startTime }
  }

  /**
   * Start monitoring an opencode process
   * @param {string} workdir - Working directory
   * @param {string[]} args - Command arguments after 'opencode'
   * @param {Function} onOutput - Callback for output chunks: (type, data, pid)
   * @returns {ChildProcess}
   */
  startProcess(workdir, args, onOutput) {
    const proc = spawn('opencode', args, {
      cwd: workdir,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const meta = {
      proc,
      buffer: '',
      startTime: Date.now(),
      workdir,
      args,
      exitCode: null
    };

    this.activeProcesses.set(proc.pid, meta);

    // Stdout handler
    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      meta.buffer += text;
      if (onOutput) onOutput('stdout', text, proc.pid);
    });

    // Stderr handler
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      meta.buffer += text;
      if (onOutput) onOutput('stderr', text, proc.pid);
    });

    // Exit handler
    proc.on('exit', (code) => {
      meta.exitCode = code;
      const duration = Date.now() - meta.startTime;
      if (onOutput) {
        onOutput('exit', {
          code,
          duration,
          buffer: meta.buffer
        }, proc.pid);
      }
      // Keep in map for 30s for late queries
      setTimeout(() => this.activeProcesses.delete(proc.pid), 30000);
    });

    return proc;
  }

  /**
   * Get status of all active processes
   */
  getStatus() {
    const active = [];
    for (const [pid, meta] of this.activeProcesses.entries()) {
      if (meta.proc.exitCode === null) {
        active.push({
          pid,
          workdir: meta.workdir,
          args: meta.args,
          startTime: meta.startTime,
          duration: Date.now() - meta.startTime,
          bufferSize: meta.buffer.length
        });
      }
    }
    return active;
  }

  /**
   * Get buffer for a specific process
   */
  getBuffer(pid) {
    const meta = this.activeProcesses.get(pid);
    return meta ? meta.buffer : null;
  }

  /**
   * Kill a process
   */
  killProcess(pid, signal = 'SIGTERM') {
    const meta = this.activeProcesses.get(pid);
    if (meta && meta.proc.exitCode === null) {
      meta.proc.kill(signal);
      return true;
    }
    return false;
  }
}

module.exports = OpenCodeStreamRelay;
