import { execFileSync } from 'node:child_process';

export default function globalTeardown(): void {
  // This command is scoped to the pinned, loopback-only Compose project.
  execFileSync('pnpm', ['run', 'integration:down'], { stdio: 'inherit' });
}
