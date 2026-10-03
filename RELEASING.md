# Releasing to npm from GitHub Actions

`.github/workflows/publish.yml` builds, tests, packs, installs, and smoke-tests one exact tarball on `main`. Its default is a dry run: it uploads the tarball without publishing. This workflow never publishes pull requests and rejects a version different from the package/lockfile version.

## One-time trusted publisher setup

The workflow can be tested before account configuration. To enable its `publish` input, configure npm's trusted publisher for **only this package and workflow**:

```bash
npm login --auth-type=web --browser=false --registry=https://registry.npmjs.org
npm trust list @zesun33/mcp-rtl-review
npm trust github @zesun33/mcp-rtl-review --repository zesun33/mcp-rtl-review --file publish.yml --allow-publish
```

This configuration requires npm 11.10+ and package write access with account 2FA. Complete npm's browser verification yourself. If a trusted publisher already exists, inspect it instead of replacing or revoking it automatically. Alternatively, use the package Settings page on npm with GitHub owner `zesun33`, repository `mcp-rtl-review`, workflow `publish.yml`, and no environment restriction (the workflow has no environment).

GitHub uses a short-lived OIDC token rather than an npm token secret. Public GitHub Actions publications get npm provenance automatically. See the [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) and [npm trust CLI reference](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Each release

1. Update `package.json`, both root lockfile versions, and release notes. Run the full local verification when runtime code changes, including current and legacy Verilator integration tests.
2. Commit and push the exact source to `main`. Wait for CI.
3. Run the release workflow with the expected version and `publish=false`. Inspect the uploaded tarball and results.
4. After configuring the trusted publisher, run the workflow with the same expected version and `publish=true`. The workflow publishes only the tested tarball and checks its registry integrity. npm versions cannot be overwritten.
5. Check a fresh registry installation, update the parent portfolio notes if needed, and create a GitHub Release with the matching source commit.

Example dry run for the existing release (does not republish it):

```bash
gh workflow run publish.yml --repo zesun33/mcp-rtl-review --ref main -f version=0.2.2 -f publish=false
```

The trusted publisher must be configured in the npm account before an actual OIDC publication. Passing a dry run confirms packaging and registration, not npm account authorization or live EDA integration.
