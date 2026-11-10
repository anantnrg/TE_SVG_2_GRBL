import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("serve builds the browser bundle before starting the static server", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.serve, /^npm run build && node tools\/server\.js$/);
});
