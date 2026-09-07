# Deployment & Auto-Update Guide

## Platform
- **Deployment Platform:** GitHub Releases (CI/CD via GitHub Actions)
- **Application Type:** Electron Desktop App (Windows NSIS & Portable)
- **Repository:** `dacthinh05/TaxInsight`
- **Release Workflow:** `.github/workflows/release.yml`

## Auto-Update Architecture
- **Update Mechanism:** `electron-updater` configured with GitHub provider.
- **Manifest:** `latest.yml` generated during `electron-builder` release.
- **Auto-Update Endpoint:** `https://github.com/dacthinh05/TaxInsight/releases/latest/download/latest.yml`
- **Installed Client Behavior:** Checks for updates upon startup and periodically in the background. Downloads differential blocks via `.blockmap` and prompts to install on quit.

## Deploy & Release Command
To trigger a new automated build and release:
```bash
# 1. Update version in package.json (e.g. 3.1.9)
npm version patch --no-git-tag-version

# 2. Commit changes
git commit -am "chore(release): bump version to v3.1.9"
git push origin master

# 3. Create and push tag to trigger GitHub Actions
git tag -a v3.1.9 -m "Release v3.1.9"
git push origin v3.1.9
```

## Environment Variables & Secrets
- `GH_TOKEN`: Automatically injected by GitHub Actions (`${{ secrets.GITHUB_TOKEN }}`) with `contents: write` permission.

## Verification
- GitHub Actions run status: `https://github.com/dacthinh05/TaxInsight/actions`
- Published Releases: `https://github.com/dacthinh05/TaxInsight/releases`
