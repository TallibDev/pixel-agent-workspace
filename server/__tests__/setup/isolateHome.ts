/**
 * Keeps every server test away from the real home directory.
 *
 * Tests redirect home by assigning `process.env.HOME`. On Windows `os.homedir()`
 * reads `USERPROFILE`, so without this file those tests wrote into the real
 * `~/.pixel-agents/` (including `bypassPermissions: true`) and could reach the
 * real `~/.claude/`.
 *
 * 1. Before any test module loads, HOME and USERPROFILE both point at a fresh
 *    temp directory, so a test that forgets to isolate itself is still safe.
 * 2. Writes and deletes of HOME are mirrored to USERPROFILE on Windows.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'paw-test-home-'));
const realEnv = process.env;

realEnv.HOME = sandboxHome;
realEnv.USERPROFILE = sandboxHome;

if (process.platform === 'win32') {
  process.env = new Proxy(realEnv, {
    set(target, key, value) {
      target[key as string] = value;
      if (key === 'HOME') target.USERPROFILE = value;
      return true;
    },
    deleteProperty(target, key) {
      delete target[key as string];
      if (key === 'HOME') target.USERPROFILE = sandboxHome;
      return true;
    },
  });
}
