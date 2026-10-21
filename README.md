# library

One repo, one branch per GitHub project. This branch, `main`, is the index and the tool, and `attic` keeps the retired ones.

## How it works

[`./library`](library) copies projects straight from GitHub. No folders on your machine, no checkout:

- **Branch name = GitHub slug.** `google-research/timesfm` is the `google-research/timesfm` branch. Clone it and you have the project.
- **Exact copies.** The tool fetches the one upstream commit with `--depth 1` and commits its tree unchanged, so the branch's tree id is the upstream tree id. `./library check --upstream` proves it for every project.
- **Branches are orphans.** They share no history with each other, with `main` or with upstream. Each commit names its upstream commit and tree in trailers (`Upstream-Commit`, `Upstream-Tree`), so the full history is one click away without being stored here.
- **Commits append.** `./library update` asks GitHub for each project's current commit and only fetches the ones that moved. A new version is a child of the previous one, so git stores just the changed files. The author date is the upstream commit's date.
- **Files are stored once.** Git keeps one copy of a file however many projects hold it.
- **Big or unlicensed projects become pointers.** A project over the size cap (`limits.project_mb` in [`library.json`](library.json), 50 MB) or with files over GitHub's 100 MB limit gets a branch holding only a README with its URL, commit and tree. So does a project with no open license, since this repo is public. `--mode lean` copies a big project without its files over `limits.lean_file_mb` (10 MB) and lists them in the commit message. Projects owned by an account under `owners` are always copied.
- **No secrets by accident.** Before a copy is made, its files are scanned for tokens and private keys. A hit stops that project and names the file and line; `--allow-secrets` copies anyway once you have looked.
- **Your changes survive updates.** Commit on top of a project's branch and the next update merges the new upstream version into your changes (a three-way merge with the previous upstream version as the base). A conflict stops that project only and names the files.
- **One push per run.** All moved branches and the new index go up in one atomic push with a lease on each branch: a run lands completely or changes nothing.

## Get a project

```bash
git clone --single-branch --depth 1 -b <owner>/<repo> https://github.com/quirq-ai/library.git <repo>
```

or, from a checkout of `main`, `./library get <owner>/<repo>`. Never clone the whole library: every project would come with it.

## Add, update and retire

Clone `main` (`git clone --single-branch -b main https://github.com/quirq-ai/library.git`), then:

```bash
./library add google-research/timesfm          # follows the default branch
./library add owner/repo --ref v1.2.0          # or a branch, tag or commit
./library add owner/repo --mode lean           # copy without files over 10 MB
./library add owner/repo --mode pointer        # keep only a pointer
./library update                               # every project whose upstream moved
./library update owner/repo                    # just these
./library check                                # branches match the index
./library check --upstream                     # and upstream still serves the same trees
./library retire owner/repo                    # squash onto attic, delete the branch
./library index                                # rewrite this table from library.json
```

Every command that writes takes `--dry-run`. Descriptions come from the project's README and can be edited in [`library.json`](library.json); the next run rewrites the table. Needs Node 20 or later and git 2.40 or later (for the merge of your changes on update).

## Repo settings

Turn GitHub Actions off for this repo (Settings, Actions, General, "Disable actions"), so workflows copied with a project can never run here. Copies keep their `.github/workflows` because removing them would break the exact-copy rule, and GitHub runs a pushed branch's `on: push` workflows even when the branch is not the default one. Until `"actions_off": true` is set in [`library.json`](library.json), the tool refuses to copy a project that has workflows. Dependabot and code scanning stay off for the same reason.

The tool reads upstream without your GitHub login, so a private repo is never copied, even one under `owners`.

## License

The Apache-2.0 [LICENSE](LICENSE) covers the tool and the index on `main`. Each project branch keeps its upstream's own license files and terms; nothing here relicenses them.

## Index

<!-- index:start -->
0 projects, 0 KB of files copied, most recently changed upstream first.

| Project | What it is | Kept as | License | Size | Upstream commit | Updated |
| --- | --- | --- | --- | --- | --- | --- |
<!-- index:end -->
