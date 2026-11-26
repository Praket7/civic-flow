import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("restore rejects remote and ambiguous destinations before running destructive tools", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "civicflow-restore-"));
  try {
    const identity = path.join(dir, "identity");
    await writeFile(identity, "test-only");
    for (const name of ["psql", "pg_restore", "aws", "age"]) {
      await writeFile(path.join(dir, name), "#!/bin/sh\necho UNEXPECTED_TOOL_CALL\nexit 99\n", {
        mode: 0o700,
      });
    }
    const env = {
      ...process.env,
      PATH: dir + path.delimiter + process.env.PATH,
      CIVICFLOW_BACKUP_OBJECT_URI: "s3://test-backups/fixture.pgdump.age",
      CIVICFLOW_BACKUP_AGE_IDENTITY_FILE: identity,
      CIVICFLOW_ALLOW_DESTRUCTIVE_RESTORE_TEST: "isolated-only",
    };
    for (const url of [
      "postgresql://db.example.org/civicflow_restore_test",
      "postgresql://127.0.0.1/production",
      "postgresql://127.0.0.1/civicflow_restore_test?host=db.example.org",
      "postgresql://127.0.0.1/civicflow_restore_test%2Fother",
    ]) {
      const result = spawnSync("bash", ["scripts/verify-cloud-restore.sh"], {
        env: { ...env, CIVICFLOW_RESTORE_DATABASE_URL: url },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Refusing restore/);
      assert.doesNotMatch(result.stdout, /UNEXPECTED_TOOL_CALL/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
