import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as io from "@actions/io";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as sysPath from "path";

async function main() {
  const userInputs: Inputs = getInputs();
  const resolvedinputs: ResolvedInputs = resolveInputs(userInputs);
  await deploy(resolvedinputs);
}

interface Inputs {
  accessToken: string;
  srcDir: string | undefined;
  destRepo: string | undefined;
  destBranch: string;
  commitUser: string | undefined;
  commitEmail: string | undefined;
}

function getInputs(): Inputs {
  const accessToken: string = core.getInput("accessToken", {required: true});
  const srcDir: string | undefined = core.getInput("srcDir", {required: false});
  const destRepo: string | undefined = core.getInput("destRepo", {required: false});
  const destBranch: string = core.getInput("destBranch", {required: true});
  const commitUser: string | undefined = core.getInput("commitUser", {required: false});
  const commitEmail: string | undefined = core.getInput("commitEmail", {required: false});
  return {accessToken, srcDir, destRepo, destBranch, commitUser, commitEmail};
}

interface ResolvedInputs {
  accessToken: string;
  srcDir: string;
  destRepo: string;
  destBranch: string;
  commitUser: string;
  commitEmail: string;
}

function resolveInputs(inputs: Inputs): ResolvedInputs {
  let destRepo: string = isDefined(inputs.destRepo)
    ? inputs.destRepo
    : `${github.context.repo.owner}/${github.context.repo.repo}`;
  const srcDir: string = isDefined(inputs.srcDir) ? inputs.srcDir : ".";
  const commitUser: string = isDefined(inputs.commitUser)
    ? inputs.commitUser
    : github.context.actor;
  const commitEmail: string = isDefined(inputs.commitEmail)
    ? inputs.commitEmail
    : `${github.context.actor}@users.noreply.github.com`;
  return {...inputs, srcDir, destRepo, commitUser, commitEmail};
}

function isDefined(optStr: string | undefined): optStr is string {
  return optStr !== undefined && optStr.length > 0;
}

async function deploy(inputs: ResolvedInputs): Promise<void> {
  const destRepoUri: string = `https://${inputs.accessToken}@github.com/${inputs.destRepo}.git`;

  return withTmpDir<void>(async (cwd: string): Promise<void> => {
    core.info("Initializing destination repository");

    await exec.exec("git", ["init"], {cwd});
    await exec.exec("git", ["config", "--local", "user.name", inputs.commitUser], {cwd});
    await exec.exec("git", ["config", "--local", "user.email", inputs.commitEmail], {cwd});
    await exec.exec("git", ["remote", "add", "dest", destRepoUri], {cwd});
    await exec.exec("git", ["fetch", "dest"], {cwd});

    let destBranchExists: boolean;
    {
      const exitCode: number = await exec.exec(
        "git",
        ["ls-remote", "--heads", "--quiet", "--exit-code", "dest", inputs.destBranch],
        {cwd, ignoreReturnCode: true},
      );
      switch (exitCode) {
        case 0: {
          destBranchExists = true;
          break;
        }
        case 2: {
          destBranchExists = false;
          break;
        }
        default:
          throw new Error("Failed to check existence of `destBranch` in destination repository");
      }
    }
    let isNewBranch: boolean;
    if (destBranchExists) {
      core.info(`Checking destination branch: ${inputs.destBranch}`);
      await exec.exec("git", ["checkout", "-t", `dest/${inputs.destBranch}`], {cwd});
      isNewBranch = false;
    } else {
      core.info(`Creating destination branch (not found in destination repo): ${inputs.destBranch}`);
      await exec.exec("git", ["checkout", "--orphan", inputs.destBranch], {cwd});
      isNewBranch = true;
    }

    core.info(`Setting destination content from source directory: ${inputs.srcDir}`);
    await rmAllExceptDotGit(cwd);
    const isNonEmpty: boolean = await copyAllExceptDotGit(inputs.srcDir, cwd);
    await exec.exec("git", ["add", "."], {cwd});

    let hasChanges: boolean;
    if (isNewBranch) {
      hasChanges = isNonEmpty;
    } else {
      const exitCode: number = await exec.exec(
        "git",
        ["diff-index", "--quiet", "HEAD", "--"],
        {cwd, ignoreReturnCode: true, silent: true},
      );
      hasChanges = exitCode != 0;
    }

    if (hasChanges) {
      core.info("Creating deployment commit");
      const sha: string = github.context.sha;
      const commitTitle: string = await getCommitTitle(sha);
      const shortSha: string = sha.substr(0, 7);
      const msgLines: ReadonlyArray<string> = [
        `Deploy(${shortSha}): ${commitTitle}`,
        "",
        `Repo: ${github.context.repo.owner}/${github.context.repo.repo}`,
        `Workflow: ${github.context.workflow}`,
        `SHA: ${sha}`,
        `Ref: ${github.context.ref}`,
        `Actor: ${github.context.actor}`,
        "",
      ];

      const msg: string = msgLines.join("\n");
      await exec.exec("git", ["commit", "-m", msg], {cwd});
      core.info("Deploying");
      await exec.exec("git", ["push", "dest", inputs.destBranch], {cwd});
    } else {
      core.info("Skipping deployment: no changes detected");
    }
  });
}

async function getCommitTitle(sha: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  await exec.exec(
    "git",
    ["log", "--format=%B", "-n", "1", sha],
    {silent: true, listeners: {stdout: data => chunks.push(data)}},
  );
  const message: string = Buffer.concat(chunks).toString("utf8");
  return message.split("\n")[0].trim();
}

async function withTmpDir<T>(fn: (dirPath: string) => Promise<T>): Promise<T> {
  const tmpDir: string = createTmpDirSync();
  try {
    return await fn(tmpDir);
  } finally {
    await io.rmRF(tmpDir);
  }
}

function createTmpDirSync(): string {
  const MAX_TRIES: number = 5;
  const tmpRoot: string = os.tmpdir();
  let tryCount: number = 0;
  while (tryCount < MAX_TRIES) {
    tryCount++;
    const name: string = `.tmp-${crypto.randomBytes(8).toString("hex")}`;
    const tmpDir: string = sysPath.join(tmpRoot, name);
    try {
      fs.mkdirSync(tmpDir);
      if (fs.statSync(tmpDir).isDirectory()) {
        return tmpDir;
      }
    } catch (e) {
      if (tryCount >= MAX_TRIES) {
        throw e;
      }
    }
  }
  throw new Error("Failed to create temporary directory");
}

async function rmAllExceptDotGit(dir: string): Promise<void> {
  const fileNames: string[] = fs.readdirSync(dir);
  const rmPromises: Promise<void>[] = [];
  for (const fileName of fileNames) {
    if (fileName === ".git") {
      continue;
    }
    rmPromises.push(io.rmRF(sysPath.join(dir, fileName)));
  }
  await Promise.all(rmPromises);
}

async function copyAllExceptDotGit(srcDir: string, destDir: string): Promise<boolean> {
  let didCopySomething: boolean = false;
  const fileNames: string[] = fs.readdirSync(srcDir);
  const cpPromises: Promise<void>[] = [];
  for (const fileName of fileNames) {
    if (fileName === ".git") {
      continue;
    }
    didCopySomething = true;
    cpPromises.push(io.cp(sysPath.join(srcDir, fileName), sysPath.join(destDir, fileName)));
  }
  await Promise.all(cpPromises);
  return didCopySomething;
}

(async () => {
  try {
    await main();
  } catch (e) {
    core.setFailed(e.message);
  }
})();
