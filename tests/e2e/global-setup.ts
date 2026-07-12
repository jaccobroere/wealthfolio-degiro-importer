import { execFileSync } from 'node:child_process';

function run(script: 'integration:down' | 'integration:up'): void {
  execFileSync('pnpm', ['run', script], { stdio: 'inherit' });
}

export default function globalSetup(): void {
  // A clean volume makes account creation and import assertions deterministic.
  run('integration:down');
  run('integration:up');
}
