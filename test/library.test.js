// End to end: a bare "origin" and bare upstream repos in a temp dir, and the real
// ./library run against them through file:// URLs.
'use strict'

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { slugArg, PLACEHOLDER } = require('../library')

const SRC = path.join(__dirname, '..')
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete ENV[key]
const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n'

let tmp, base, origin, lib

function sh(cmd, args, cwd, extra = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...ENV, LIBRARY_UPSTREAM: `file://${base}`, ...extra }, encoding: 'utf8' })
  return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout }
}
function git(args, cwd = lib) {
  const r = sh('git', args, cwd)
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.out}`)
  return r.stdout.trim()
}
const library = (...args) => sh(path.join(lib, 'library'), args, lib)
const manifest = () => JSON.parse(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'))
const remoteTree = (branch) => {
  git(['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
  return git(['rev-parse', `origin/${branch}^{tree}`])
}

// An upstream project: a bare repo at <base>/<slug>.git, written through a work clone.
function upstream(slug, files, message = 'init') {
  const bare = path.join(base, `${slug}.git`)
  const work = path.join(tmp, 'work', slug)
  if (!fs.existsSync(bare)) {
    fs.mkdirSync(bare, { recursive: true })
    git(['init', '-q', '--bare', '-b', 'main', bare], bare)
    git(['config', 'uploadpack.allowAnySHA1InWant', 'true'], bare)
    fs.mkdirSync(work, { recursive: true })
    git(['init', '-q', '-b', 'main'], work)
    git(['remote', 'add', 'origin', bare], work)
  }
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(work, name)
    if (content === null) fs.rmSync(file)
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
  }
  git(['add', '-A'], work)
  git(['commit', '-q', '-m', message], work)
  git(['push', '-q', 'origin', 'main'], work)
  return { sha: git(['rev-parse', 'HEAD'], work), tree: git(['rev-parse', 'HEAD^{tree}'], work) }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'library-test-'))
  base = path.join(tmp, 'upstream')
  origin = path.join(tmp, 'origin.git')
  lib = path.join(tmp, 'lib')
  fs.mkdirSync(base)
  git(['init', '-q', '--bare', '-b', 'main', origin], tmp)
  git(['config', 'uploadpack.allowAnySHA1InWant', 'true'], origin)
  git(['clone', '-q', origin, lib], tmp)
  for (const f of ['library', 'library.json', 'README.md']) fs.copyFileSync(path.join(SRC, f), path.join(lib, f))
  fs.chmodSync(path.join(lib, 'library'), 0o755)
  const m = manifest()
  m.limits = { project_mb: 0.05, lean_file_mb: 0.01 } // 51 KB per project, files over 10 KB are large
  fs.writeFileSync(path.join(lib, 'library.json'), `${JSON.stringify(m, null, 2)}\n`)
  git(['checkout', '-q', '-b', 'main'])
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'tool'])
  git(['push', '-q', 'origin', 'main'])
})

test('slugs come from owner/repo or a GitHub URL', () => {
  assert.equal(slugArg('https://github.com/google-research/timesfm.git'), 'google-research/timesfm')
  assert.equal(slugArg('a/b/'), 'a/b')
  assert.ok(PLACEHOLDER.test('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'))
  assert.ok(PLACEHOLDER.test('AKIAIOSFODNN7EXAMPLE'))
})

test('add makes an exact copy whose tree is the upstream tree', () => {
  const up = upstream('acme/tool', { 'README.md': 'A tool that does things. More text.\n', LICENSE: MIT, 'src/a.js': 'x\n' })
  const r = library('add', 'acme/tool')
  assert.equal(r.status, 0, r.out)
  assert.equal(remoteTree('acme/tool'), up.tree)
  const body = git(['log', '-1', '--format=%B', 'origin/acme/tool'])
  assert.match(body, new RegExp(`Upstream-Commit: ${up.sha}`))
  assert.match(body, new RegExp(`Upstream-Tree: ${up.tree}`))
  assert.equal(git(['rev-list', '--count', 'origin/acme/tool']), '1')
  const e = manifest().projects['acme/tool']
  assert.equal(e.mode, 'copy')
  assert.equal(e.license, 'MIT')
  assert.equal(e.description, 'A tool that does things.')
  git(['fetch', '-q', 'origin', 'main'])
  assert.match(git(['show', 'origin/main:README.md']), /\[acme\/tool\]\(.*\/tree\/acme\/tool\) \| A tool that does things\. \| exact copy \| MIT/)
  assert.equal(library('add', 'acme/tool').status, 1)
})

test('no open license means a pointer, unless the owner is ours', () => {
  upstream('stranger/code', { 'README.md': 'Code.\n', 'a.txt': 'a\n' })
  const r = library('add', 'stranger/code')
  assert.equal(r.status, 0, r.out)
  const e = manifest().projects['stranger/code']
  assert.equal(e.mode, 'pointer')
  git(['fetch', '-q', 'origin', 'stranger/code'])
  assert.deepEqual(git(['ls-tree', '--name-only', 'FETCH_HEAD']).split('\n'), ['README.md'])
  assert.match(git(['show', 'FETCH_HEAD:README.md']), /no open license/)

  const up = upstream('quirq-ai/thing', { 'a.txt': 'a\n' })
  assert.equal(library('add', 'quirq-ai/thing').status, 0)
  assert.equal(remoteTree('quirq-ai/thing'), up.tree)
})

test('over the cap is a pointer; lean drops the large files', () => {
  const big = 'b'.repeat(60 * 1024)
  upstream('acme/big', { LICENSE: MIT, 'big.bin': big, 'small.txt': 's\n' })
  const r0 = library('add', 'acme/big')
  assert.equal(r0.status, 0, r0.out)
  assert.equal(manifest().projects['acme/big'].mode, 'pointer')

  upstream('acme/lean', { LICENSE: MIT, 'assets/big.bin': big, 'small.txt': 's\n' })
  const r = library('add', 'acme/lean', '--mode', 'lean')
  assert.equal(r.status, 0, r.out)
  const e = manifest().projects['acme/lean']
  assert.equal(e.mode, 'lean')
  git(['fetch', '-q', 'origin', 'acme/lean'])
  assert.deepEqual(git(['ls-tree', '-r', '--name-only', 'FETCH_HEAD']).split('\n'), ['LICENSE', 'small.txt'])
  assert.match(git(['log', '-1', '--format=%B', 'FETCH_HEAD']), /assets\/big\.bin/)
})

test('a likely secret stops the copy; placeholders do not', () => {
  upstream('acme/leaky', { LICENSE: MIT, 'conf.js': `token = "ghp_${'aB3'.repeat(13)}"\n` })
  const r = library('add', 'acme/leaky')
  assert.equal(r.status, 1)
  assert.match(r.out, /conf\.js:1 \(GitHub token\)/)
  assert.doesNotMatch(r.out, /aB3aB3/)
  assert.equal(manifest().projects['acme/leaky'], undefined)

  upstream('acme/docs', { LICENSE: MIT, 'README.md': 'Set GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' })
  assert.equal(library('add', 'acme/docs').status, 0)
})

test('update appends a child commit only when upstream moved', () => {
  upstream('acme/tool', { LICENSE: MIT, 'a.txt': '1\n' })
  library('add', 'acme/tool')
  const first = manifest().projects['acme/tool'].snapshot
  assert.match(library('update').out, /unchanged/)

  const up = upstream('acme/tool', { 'a.txt': '2\n' }, 'two')
  const r = library('update')
  assert.equal(r.status, 0, r.out)
  assert.equal(remoteTree('acme/tool'), up.tree)
  assert.equal(git(['rev-parse', 'origin/acme/tool^']), first)
  assert.equal(manifest().projects['acme/tool'].upstream_commit, up.sha)
})

test('your commits on a branch survive an update, and a clash stops it', () => {
  upstream('acme/tool', { LICENSE: MIT, 'a.txt': '1\n', 'b.txt': 'b\n' })
  library('add', 'acme/tool')
  const mine = path.join(tmp, 'mine')
  git(['clone', '-q', '-b', 'acme/tool', origin, mine], tmp)
  fs.writeFileSync(path.join(mine, 'b.txt'), 'patched\n')
  git(['commit', '-q', '-am', 'my patch'], mine)
  git(['push', '-q', 'origin', 'acme/tool'], mine)

  upstream('acme/tool', { 'a.txt': '2\n' }, 'two')
  const r = library('update')
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /merged with your changes/)
  git(['fetch', '-q', 'origin', '+acme/tool:refs/remotes/origin/acme/tool'])
  assert.equal(git(['show', 'origin/acme/tool:a.txt']), '2')
  assert.equal(git(['show', 'origin/acme/tool:b.txt']), 'patched')
  assert.match(library('check').out, /with your changes on top/)

  upstream('acme/tool', { 'b.txt': 'theirs\n' }, 'three')
  const clash = library('update')
  assert.match(clash.out, /conflict .*b\.txt/)
  assert.equal(git(['show', 'origin/acme/tool:b.txt']), 'patched')
})

test('check passes, then catches a stray branch', () => {
  upstream('acme/tool', { LICENSE: MIT, 'a.txt': '1\n' })
  library('add', 'acme/tool')
  const ok = library('check', '--upstream')
  assert.equal(ok.status, 0, ok.out)
  assert.match(ok.out, /All 1 project check out/)

  git(['push', '-q', 'origin', 'HEAD:refs/heads/stray/branch'])
  const bad = library('check')
  assert.equal(bad.status, 1)
  assert.match(bad.out, /stray\/branch .*does not list/)
})

test('retire squashes onto attic and deletes the branch', () => {
  const up = upstream('acme/tool', { LICENSE: MIT, 'a.txt': '1\n' })
  library('add', 'acme/tool')
  upstream('acme/tool', { 'a.txt': '2\n' }, 'two')
  library('update')
  const r = library('retire', 'acme/tool')
  assert.equal(r.status, 0, r.out)
  const heads = git(['ls-remote', '--heads', 'origin'])
  assert.doesNotMatch(heads, /acme\/tool/)
  assert.equal(git(['rev-list', '--count', `${manifest().retired['acme/tool'].attic_commit}`]), '1')
  assert.notEqual(remoteTree('attic'), up.tree)
  assert.equal(manifest().projects['acme/tool'], undefined)
})

test('dry run writes and pushes nothing', () => {
  upstream('acme/tool', { LICENSE: MIT, 'a.txt': '1\n' })
  const before = fs.readFileSync(path.join(lib, 'library.json'), 'utf8')
  const r = library('add', 'acme/tool', '--dry-run')
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /would add/)
  assert.equal(fs.readFileSync(path.join(lib, 'library.json'), 'utf8'), before)
  assert.doesNotMatch(git(['ls-remote', '--heads', 'origin']), /acme/)
})

test('a failed push leaves origin and the checkout as they were', () => {
  upstream('acme/tool', { LICENSE: MIT, 'a.txt': '1\n' })
  const hook = path.join(origin, 'hooks', 'pre-receive')
  fs.writeFileSync(hook, '#!/bin/sh\necho refused >&2\nexit 1\n')
  fs.chmodSync(hook, 0o755)
  const head = git(['rev-parse', 'HEAD'])
  const r = library('add', 'acme/tool')
  assert.equal(r.status, 1)
  assert.match(r.out, /nothing changed/)
  assert.equal(git(['rev-parse', 'HEAD']), head)
  assert.deepEqual(manifest().projects, {})
  assert.equal(git(['status', '--porcelain']), '')
})

test('upstream is read without the caller\'s git config or logins', () => {
  upstream('hidden/thing', { LICENSE: MIT, 'a.txt': 'private\n' })
  const config = path.join(tmp, 'gitconfig')
  // Stands in for a stored login: the caller's own config can reach a repo a stranger cannot.
  fs.writeFileSync(config, `[url "file://${base}/hidden/"]\n\tinsteadOf = file://${base}/sharmasuraj0123/\n`)
  const r = sh(path.join(lib, 'library'), ['add', 'sharmasuraj0123/thing'], lib, { GIT_CONFIG_GLOBAL: config })
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /without logging in/)
  assert.doesNotMatch(git(['ls-remote', '--heads', 'origin']), /thing/)
})

test('runs only from main with nothing unpushed', () => {
  upstream('acme/tool', { LICENSE: MIT, 'a.txt': '1\n' })
  const main = git(['rev-parse', 'HEAD'])
  git(['switch', '-q', '-c', 'feature'])
  fs.appendFileSync(path.join(lib, 'README.md'), 'unreviewed\n')
  git(['commit', '-q', '-am', 'unreviewed'])
  assert.match(library('add', 'acme/tool').out, /from main/)
  git(['switch', '-q', 'main'])
  git(['merge', '-q', '--ff-only', 'feature'])
  assert.match(library('add', 'acme/tool').out, /not on origin\/main/)
  assert.equal(git(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], main)
})

test('source-available and open-core licenses are not open', () => {
  upstream('acme/fsl', { 'LICENSE.md': '# Functional Source License, Version 1.1, Apache 2.0 Future License\n\nLicensed under the Apache License, Version 2.0\n', 'a.txt': 'a\n' })
  assert.equal(library('add', 'acme/fsl').status, 0)
  assert.equal(manifest().projects['acme/fsl'].mode, 'pointer')
  upstream('acme/core', { LICENSE: MIT, 'ee/LICENSE': 'The Acme Enterprise License\n', 'a.txt': 'a\n' })
  assert.equal(library('add', 'acme/core').status, 0)
  assert.equal(manifest().projects['acme/core'].mode, 'pointer')
})

test('a project with workflows waits until Actions is off', () => {
  upstream('acme/ci', { LICENSE: MIT, '.github/workflows/ci.yml': 'on: push\n' })
  const r = library('add', 'acme/ci')
  assert.equal(r.status, 1)
  assert.match(r.out, /Disable actions/)
  const m = manifest()
  m.actions_off = true
  fs.writeFileSync(path.join(lib, 'library.json'), `${JSON.stringify(m, null, 2)}\n`)
  git(['commit', '-q', '-am', 'Actions are off'])
  git(['push', '-q', 'origin', 'main'])
  assert.equal(library('add', 'acme/ci').status, 0)
  assert.equal(manifest().projects['acme/ci'].mode, 'copy')
})
