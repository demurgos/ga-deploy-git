import core from "@actions/core";
import exec from "@actions/exec";
import github from "@actions/github";
import io from "@actions/io";
import sysPath from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

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

  return withTmpDir<void>(async (tmpDir: string): Promise<void> => {
    // Clone dest repository
    if (await exec.exec("git", ["clone", destRepoUri, tmpDir]) !== 0) {
      throw new Error(`Failed to clone destination repo: ${destRepoSlug}`);
    }
    console.log("Done");
  });
}

async function withTmpDir<T>(fn: (dirPath: string) => Promise<T>): Promise<T> {
  const tmpDir: string = createTmpDirSync();
  try {
    return fn(tmpDir);
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
    const name: string = crypto.randomBytes(8).toString("hex");
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
