# Agent guide

Read README.md first. Rules for changing this repo:

1. **main holds only the tool and the index.** `library`, `library.json`, `README.md`, the tests and these docs. Project branches are written only by `./library`; never push to one by hand except your own patches on top of a project.
2. **Copies stay exact.** Never edit a copy's tree to make it fit (removing workflows, secrets or big files). Use `--mode lean` or `--mode pointer`, which record what they did.
3. **Public repo.** Copy only what has an open license or belongs to an account under `owners`. Never commit a token; the secret scan is a backstop, not a licence to skip looking.
4. **Never clone the whole library.** Use `git clone --single-branch -b main` for the tool and `./library get` for one project.
5. **No dependencies.** The tool is one Node script using only Node built-ins and git.
6. Before pushing: `npm test`.
