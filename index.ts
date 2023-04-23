const core = require("@actions/core");
import * as github from "@actions/github";
const YAML = require("yaml");
const minimatch = require("minimatch");
const { readFileSync } = require("fs");

const header = core.getInput("comment-header");
const footer = core.getInput("comment-footer");

const minimatchOptions = {
  dot: core.getInput("include-hidden-files") === "true",
};

function getChecklistPaths(): Record<string, string[]> {
  const inputFile = core.getInput("input-file");
  const parsedFile = YAML.parse(readFileSync(inputFile, { encoding: "utf8" }));
  return parsedFile.paths;
}

function formatItemsForPath([path, items]): string {
  const showPaths = core.getInput("show-paths") === "true";

  return showPaths
    ? [
        `__Files matching \`${path}\`:__\n`,
        ...items.map((item) => `- [ ] ${item}\n`),
        "\n",
      ].join("")
    : [...items.map((item) => `- [ ] ${item}\n`)].join("");
}

async function run() {
  const context = github.context;
  const { owner, repo } = context.repo;
  const number = (
    context.payload.issue ??
    context.payload.pull_request ??
    context.payload
  ).number;

  const ghToken = core.getInput("gh-token");
  const client = github.getOctokit(ghToken);
  const checklistPaths = getChecklistPaths();
  let modifiedPaths: string[] = [];

  //INFO Getting paths from PR
  const modifiedPathsFromPR: string[] = (
    await client.rest.pulls.listFiles({
      owner: owner,
      repo: repo,
      pull_number: number,
    })
  ).data.map((file) => file.filename);
  modifiedPaths = modifiedPaths.concat(
    modifiedPathsFromPR.map((file: any) => file.filename)
  );

  //INFO Getting paths between base and head commits (compareCommits)
  let compareCommitsList: any = [];
  if (core.getInput("compareCommits")) {
    compareCommitsList = JSON.parse(core.getInput("compareCommits"));
    compareCommitsList.forEach(async (compareCommit) => {
      const modifiedPathsFromCommit: string[] = (
        await client.rest.repos.compareCommits({
          owner: compareCommit.owner,
          repo: compareCommit.repo,
          base: compareCommit.base,
          head: compareCommit.head,
        })
      ).data.files.map((file) => file.filename);

      modifiedPaths.concat(
        modifiedPathsFromCommit.map((file: any) => file.filename)
      );
    });
  }

  //INFO Preparing applicableChecklistPaths with all checklistPaths
  const applicableChecklistPaths = Object.entries(checklistPaths).filter(
    ([key, _]) => {
      for (const modifiedPath of modifiedPaths) {
        if (minimatch(modifiedPath, key, minimatchOptions)) {
          return true;
        }
      }
      return false;
    }
  );

  const existingComment = (
    await client.rest.issues.listComments({
      owner: owner,
      repo: repo,
      issue_number: number,
    })
  ).data.find((comment) => comment.body.includes(footer));

  if (applicableChecklistPaths.length > 0) {
    const body = [
      `${header}\n\n`,
      ...applicableChecklistPaths.map(formatItemsForPath),
      `\n${footer}`,
    ].join("");

    if (existingComment) {
      await client.rest.issues.updateComment({
        owner: owner,
        repo: repo,
        comment_id: existingComment.id,
        body,
      });
    } else {
      await client.rest.issues.createComment({
        owner: owner,
        repo: repo,
        issue_number: number,
        body,
      });
    }
  } else {
    if (existingComment) {
      await client.rest.issues.deleteComment({
        owner: owner,
        repo: repo,
        comment_id: existingComment.id,
      });
    }
    console.log("No paths were modified that match checklist paths");
  }
}

run().catch((err) => core.setFailed(err.message));
