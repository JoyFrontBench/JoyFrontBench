import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function dockerEnvironment(root, extra = {}) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'run') {
  fs.writeFileSync(process.env.DOCKER_ARGS_OUTPUT, JSON.stringify(args));
  const mount = args.find((argument) => argument.startsWith('type=bind,src=') && argument.endsWith(',dst=/output'));
  if (mount && args.includes('eval:pipeline') && !process.env.DOCKER_NO_STATE) {
    const output = mount.slice('type=bind,src='.length, -',dst=/output'.length);
    fs.mkdirSync(output, { recursive: true });
    const stage = process.env.DOCKER_PIPELINE_STATUS || (args.includes('--dry-run') ? 'prepared' : 'ready');
    fs.writeFileSync(path.join(output, 'pipeline-state.json'), JSON.stringify({ stage }));
  }
  if (process.env.DOCKER_HOLD_RUN) setInterval(() => {}, 1000);
  else process.exit(Number(process.env.DOCKER_RUN_EXIT || 0));
}
`, { mode: 0o755 });
  return {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: root,
    AUTO_EVAL_ENV_FILE: '',
    AUTO_EVAL_SKIP_BUILD: 'true',
    AUTO_EVAL_CODEX_HOME: join(root, 'personal-codex-home'),
    DOCKER_CALLS: join(root, 'docker-calls.jsonl'),
    DOCKER_ARGS_OUTPUT: join(root, 'docker-args.json'),
    ...extra,
  };
}
