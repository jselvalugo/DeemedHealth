/**
 * Finds a PostgreSQL 16+ server for the integration tests, in this order:
 *
 *   1. DATABASE_URL: an existing server (CI uses a postgres:16 service). The URL must
 *      carry credentials that can CREATE DATABASE and CREATE ROLE, and the server should
 *      be disposable: the tests create a scratch database and give the app roles test
 *      passwords. If DATABASE_URL is set but unreachable, that is an error, not a skip.
 *   2. Local binaries (PG_BIN if set, else /usr/lib/postgresql/16/bin or `pg_config --bindir`):
 *      initdb + pg_ctl start a throwaway cluster in a temp dir on a random port, torn
 *      down afterwards. initdb refuses to run as root, so under root the harness runs
 *      the server binaries as an unprivileged OS user (DH_TEST_PG_OS_USER, default
 *      "postgres") through the uid/gid spawn options.
 *   3. Docker: a throwaway postgres:16 container, if a Docker daemon answers.
 *
 * When none is available it returns a skip reason; the caller decides whether that is
 * allowed (locally) or fatal (CI).
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chown, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

export interface PgInstance {
  /** Superuser (or equivalent) URL to the maintenance database. */
  adminUrl: string;
  source: 'DATABASE_URL' | 'local-binaries' | 'docker';
  stop(): Promise<void>;
}

export type PgAcquisition = PgInstance | { skipReason: string };

async function canConnect(url: string, attempts = 1, delayMs = 500): Promise<Error | null> {
  let last: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      const { rows } = await client.query<{ v: number }>(
        "SELECT current_setting('server_version_num')::int AS v",
      );
      await client.end();
      const version = rows[0]?.v ?? 0;
      if (version < 160000) return new Error(`PostgreSQL 16+ required, found ${version}`);
      return null;
    } catch (error) {
      last = error as Error;
      await client.end().catch(() => undefined);
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return last;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function findOsUser(name: string): { uid: number; gid: number } | null {
  try {
    for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const [user, , uid, gid] = line.split(':');
      if (user === name && uid && gid) return { uid: Number(uid), gid: Number(gid) };
    }
  } catch {
    // no /etc/passwd (not Linux)
  }
  return null;
}

async function findPgBin(): Promise<string | null> {
  // PG_BIN, when set, is the only place looked at.
  if (process.env.PG_BIN !== undefined) {
    const dir = process.env.PG_BIN;
    return existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl')) ? dir : null;
  }
  const candidates = ['/usr/lib/postgresql/16/bin'];
  try {
    const { stdout } = await execFileAsync('pg_config', ['--bindir']);
    candidates.push(stdout.trim());
  } catch {
    // pg_config not on PATH
  }
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl'))) return dir;
  }
  return null;
}

function run(
  command: string,
  args: string[],
  ids: { uid: number; gid: number } | null,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
      ...(ids ? { uid: ids.uid, gid: ids.gid } : {}),
    });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

async function startLocalCluster(log: (m: string) => void): Promise<PgAcquisition> {
  const bin = await findPgBin();
  if (!bin)
    return { skipReason: 'no PostgreSQL binaries found (set PG_BIN or install postgresql-16)' };

  let ids: { uid: number; gid: number } | null = null;
  if (process.getuid?.() === 0) {
    const osUser = process.env.DH_TEST_PG_OS_USER ?? 'postgres';
    ids = findOsUser(osUser);
    if (!ids)
      return {
        skipReason: `running as root and OS user "${osUser}" does not exist (initdb refuses root)`,
      };
  }

  const dir = await mkdtemp(join(tmpdir(), 'dh-pg-'));
  if (ids) await chown(dir, ids.uid, ids.gid);
  const data = join(dir, 'data');
  const port = await freePort();
  const cleanup = () => rm(dir, { recursive: true, force: true });

  const init = await run(
    join(bin, 'initdb'),
    ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C', '--no-sync'],
    ids,
  );
  if (init.code !== 0) {
    await cleanup();
    return { skipReason: `initdb failed: ${init.output.trim().split('\n').slice(-3).join(' | ')}` };
  }
  const options = [
    `-p ${port}`,
    `-k ${dir}`,
    '-c listen_addresses=127.0.0.1',
    '-c fsync=off',
    '-c synchronous_commit=off',
    '-c full_page_writes=off',
    '-c max_connections=50',
  ].join(' ');
  const start = await run(
    join(bin, 'pg_ctl'),
    ['-D', data, '-l', join(dir, 'server.log'), '-o', options, '-w', '-t', '60', 'start'],
    ids,
  );
  if (start.code !== 0) {
    await cleanup();
    return {
      skipReason: `pg_ctl start failed: ${start.output.trim().split('\n').slice(-3).join(' | ')}`,
    };
  }
  log(`started throwaway PostgreSQL cluster on 127.0.0.1:${port} (${bin})`);
  return {
    adminUrl: `postgres://postgres@127.0.0.1:${port}/postgres`,
    source: 'local-binaries',
    async stop() {
      await run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], ids);
      await cleanup();
    },
  };
}

async function startDocker(log: (m: string) => void): Promise<PgAcquisition> {
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5000 });
  } catch {
    return { skipReason: 'no Docker daemon' };
  }
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'run',
        '-d',
        '--rm',
        '-e',
        'POSTGRES_HOST_AUTH_METHOD=trust',
        '-p',
        '127.0.0.1::5432',
        'postgres:16',
      ],
      { timeout: 180_000 },
    );
    const container = stdout.trim();
    const { stdout: portOut } = await execFileAsync('docker', ['port', container, '5432/tcp']);
    const port = portOut.trim().split('\n')[0]?.split(':').pop();
    const adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
    const error = await canConnect(adminUrl, 60, 1000);
    if (error) {
      await execFileAsync('docker', ['rm', '-f', container]).catch(() => undefined);
      return { skipReason: `docker postgres:16 did not become ready: ${error.message}` };
    }
    log(`started throwaway postgres:16 container ${container.slice(0, 12)} on port ${port}`);
    return {
      adminUrl,
      source: 'docker',
      async stop() {
        await execFileAsync('docker', ['rm', '-f', container]).catch(() => undefined);
      },
    };
  } catch (error) {
    return {
      skipReason: `docker run postgres:16 failed: ${(error as Error).message.split('\n')[0]}`,
    };
  }
}

export async function acquirePostgres(
  log: (m: string) => void = () => undefined,
): Promise<PgAcquisition> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const error = await canConnect(url, 10, 1000);
    if (error) throw new Error(`DATABASE_URL is set but not usable: ${error.message}`);
    return { adminUrl: url, source: 'DATABASE_URL', stop: async () => undefined };
  }
  const reasons: string[] = [];
  const local = await startLocalCluster(log);
  if (!('skipReason' in local)) return local;
  reasons.push(`local binaries: ${local.skipReason}`);
  const docker = await startDocker(log);
  if (!('skipReason' in docker)) return docker;
  reasons.push(`docker: ${docker.skipReason}`);
  return { skipReason: `DATABASE_URL is not set; ${reasons.join('; ')}` };
}

/** The same server URL pointing at another database, optionally as another user. */
export function withDatabase(
  url: string,
  database: string,
  user?: { name: string; password: string },
): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
}
