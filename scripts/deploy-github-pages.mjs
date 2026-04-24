import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const remoteName = process.env.GITHUB_PAGES_REMOTE || 'origin';
const branchName = process.env.GITHUB_PAGES_BRANCH || 'gh-pages';

function log(message) {
  console.log(`[deploy-github-pages] ${message}`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf8',
    ...options,
  }).trim();
}

function runInDir(cwd, command, args) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
}

function parseGithubRemote(remoteUrl) {
  const normalized = remoteUrl.trim();
  const sshMatch = normalized.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+?)(?:\.git)?$/i);
  if (!sshMatch?.groups) {
    throw new Error(`Unsupported GitHub remote URL: ${remoteUrl}`);
  }

  return {
    owner: sshMatch.groups.owner,
    repo: sshMatch.groups.repo,
  };
}

function getRemoteUrl() {
  try {
    return run('git', ['remote', 'get-url', remoteName]);
  } catch {
    throw new Error(`Git remote "${remoteName}" was not found.`);
  }
}

function buildForPages(basePath) {
  log(`Building app with base path "${basePath}"...`);
  const env = {
    ...process.env,
    VITE_BASE_PATH: basePath,
  };

  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm run build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env,
    });
    return;
  }

  execFileSync('npm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  });
}

function prepareDist() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Build output not found at ${distDir}`);
  }

  fs.writeFileSync(path.join(distDir, '.nojekyll'), '');

  const indexPath = path.join(distDir, 'index.html');
  const notFoundPath = path.join(distDir, '404.html');
  fs.copyFileSync(indexPath, notFoundPath);
}

function deployDist(remoteUrl) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dancerail3-editor-gh-pages-'));

  try {
    fs.cpSync(distDir, tempDir, { recursive: true });
    runInDir(tempDir, 'git', ['init']);
    runInDir(tempDir, 'git', ['checkout', '-b', branchName]);
    runInDir(tempDir, 'git', ['add', '--all']);
    runInDir(tempDir, 'git', ['commit', '-m', 'Deploy GitHub Pages']);
    runInDir(tempDir, 'git', ['remote', 'add', remoteName, remoteUrl]);
    runInDir(tempDir, 'git', ['push', '--force', remoteName, `${branchName}:${branchName}`]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const remoteUrl = getRemoteUrl();
  const { owner, repo } = parseGithubRemote(remoteUrl);
  const basePath = `/${repo}/`;
  const pagesUrl = `https://${owner}.github.io/${repo}/`;

  log(`Resolved GitHub Pages URL: ${pagesUrl}`);
  buildForPages(basePath);
  prepareDist();
  deployDist(remoteUrl);
  log(`Deployment complete. Configure GitHub Pages to serve the "${branchName}" branch root if needed.`);
  log(`Published URL: ${pagesUrl}`);
}

try {
  main();
} catch (error) {
  console.error('[deploy-github-pages] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
