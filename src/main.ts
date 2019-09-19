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
  srcBranch: string | undefined;
  srcDir: string | undefined;
  destBranch: string;
}

function getInputs(): Inputs {
  const accessToken: string = core.getInput("accessToken", {required: true});
  const srcBranch: string | undefined = core.getInput("srcBranch", {required: false});
  const srcDir: string | undefined = core.getInput("srcBranch", {required: false});
  const destBranch: string = core.getInput("destBranch", {required: true});
  return {accessToken, srcBranch, srcDir, destBranch};
}

interface ResolvedInputs {
  accessToken: string;
  srcBranch: string;
  srcDir: string;
  destBranch: string;
}

function resolveInputs(inputs: Inputs): ResolvedInputs {
  let srcBranch: string;
  if (inputs.srcBranch !== undefined) {
    srcBranch = inputs.srcBranch;
  } else {
    // https://help.github.com/en/articles/events-that-trigger-workflows
    // https://developer.github.com/v3/activity/events/types
    if (github.context.eventName === "push") {
      srcBranch = github.context.ref;
    } else {
      throw new Error(`Unable to resolve default \`srcBranch\` input for non \`push\` event: ${github.context.eventName}`);
    }
  }
  const srcDir: string = inputs.srcDir !== undefined ? inputs.srcDir : ".";
  return {...inputs, srcBranch, srcDir};
}

async function deploy(inputs: ResolvedInputs): Promise<void> {
  const destRepoSlug: string = `${github.context.repo.owner}/${github.context.repo.repo}`; // TODO: Allow to configure it
  const destRepoUri: string = `https://${inputs.accessToken}@github.com/${destRepoSlug}.git`;

  return withTmpDir<void>(async (cwd: string): Promise<void> => {
    await exec.exec("git", ["init"], {cwd});
    await exec.exec("git", ["config", "--local", "user.name", "foo"], {cwd});
    await exec.exec("git", ["config", "--local", "user.email", "foo@example.com"], {cwd});
    await exec.exec("git", ["remote", "add", "dest", destRepoUri], {cwd});
    await exec.exec("git", ["fetch", "dest"], {cwd});

    // if ( !== 0) {
    //   throw new Error(`Failed to clone destination repo: ${destRepoSlug}`);
    // }

    // Clone dest repository
    // if (await exec.exec("git", ["clone", destRepoUri, tmpDir]) !== 0) {
    //   throw new Error(`Failed to clone destination repo: ${destRepoSlug}`);
    // }
    console.log("Done");
  });
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
  const tmpRoot: string = os.homedir(); // os.tmpdir();
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

(async () => {
  try {
    await main();
  } catch (e) {
    core.setFailed(e.message);
  }
})();
