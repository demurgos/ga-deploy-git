# GitHub Action to deploy a project using Git

This action allows you to deploy a directory as the content of a Git branch.
This only supports deployment across repositories hosted on GitHub.

You can use it for example to deploy to GitHub Pages.

It checks out a remote branch, updates its content, creates a commit and pushes
it.

It is implemented as a Node action using only the official actions toolkit and
Node's core modules: it is fast and runs on every platform.

## Inputs

### `accessToken`

**Required**

Personal access token with read/write access to the repo (`public_repo` or
`repo scope` depending on the visibility of the repo).

See <https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line>

**Store it in a _secret_.** You can configure secrets in your repository settings.

### `srcDir`

Directory in the source branch containing the files to deploy.

Default: `"."` (repository root)

### `destRepo`

Destination repo slug in the form `"userOrOrganization/repoName"`.

Default: repo that triggered the workflow.

### `destBranch`

**Required**

Destination branch: the files will be deployed at its root.

## Example

This library was developed to support deploying a website build to GitHub Pages.
As part of your workflow, you can build the website to a directory and then
deploy this directory as the content of the `gh-pages` branch (or `master`
branch of `user/user.github.io`).

Here is an example workflow to deploy from a repository containing website
sources and deploying to `user/user.github.io`.

```yml
name: "Build and Deploy"
# Only deploy from `master`
on:
  push:
    branches:
      - master

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      # Checkout the branch that triggered the workflow.
      - name: Checkout
        uses: actions/checkout@master

      # Run your build step
      - name: Build
        run: ./build.sh

      # Deploy using `demurgos/ga-deploy-git`
      - name: Deploy
        uses: demurgos/ga-deploy-git@v1
        with:
          # Personnal access token with `public_repo` or `repo` permission (required)
          # It is defined in the `ACCESS_TOKEN` secret.
          accessToken: ${{ secrets.ACCESS_TOKEN }}
          # Directory containing the build artifact to deploy (default: repo root)
          srcDir: build
          # Destination repo (default: current repo)
          destRepo: user/user.github.io
          # Destination branch (required)
          destBranch: master
```
