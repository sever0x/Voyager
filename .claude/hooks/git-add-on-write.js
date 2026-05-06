#!/usr/bin/env node
// Runs after Write tool — stages the newly created file with git add.
const { execFileSync } = require("child_process");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let filePath;
  try {
    filePath = JSON.parse(input)?.tool_input?.file_path;
  } catch {
    process.exit(0);
  }

  if (!filePath) process.exit(0);

  try {
    execFileSync("git", ["add", filePath], { stdio: "inherit" });
  } catch {
    // Not a git repo or path doesn't exist yet — ignore silently.
  }
});
