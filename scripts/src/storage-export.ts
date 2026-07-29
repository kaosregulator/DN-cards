/**
 * Export every object out of Replit Object Storage onto local disk.
 *
 * A pg_dump does NOT capture card art. Cards store `image_url` as either an
 * external URL or an `/objects/...` path pointing into a Replit-hosted GCS
 * bucket (see artifacts/api-server/src/lib/objectStorage.ts). This script walks
 * the buckets named by PRIVATE_OBJECT_DIR and PUBLIC_OBJECT_SEARCH_PATHS and
 * downloads their contents, so the images survive leaving Replit.
 *
 *   pnpm --filter @workspace/scripts run storage:export -- --out backups/objects
 *   pnpm --filter @workspace/scripts run storage:export -- --out backups/objects --dry-run
 *
 * Must run inside Replit: authentication goes through the Replit sidecar on
 * 127.0.0.1:1106, which only exists in that environment.
 */

import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

type Args = { out: string; dryRun: boolean };

type ExportedObject = {
  bucket: string;
  name: string;
  size: number;
  updated: string | null;
  md5: string | null;
  localPath: string;
};

function usage(): string {
  return [
    "Usage: pnpm --filter @workspace/scripts run storage:export -- --out <dir> [--dry-run]",
    "",
    "Downloads all Replit Object Storage objects into <dir>, preserving bucket",
    "and object paths, and writes <dir>/manifest.json.",
    "Requires PRIVATE_OBJECT_DIR and/or PUBLIC_OBJECT_SEARCH_PATHS.",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--out") {
      args.out = argv[++i] ?? "";
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  if (!args.out) throw new Error(`Missing required --out.\n${usage()}`);
  return args;
}

/**
 * Split "/bucket-name/some/prefix" into its bucket and prefix, matching
 * parseObjectPath in artifacts/api-server/src/lib/objectStorage.ts.
 */
function parseObjectDir(dir: string): { bucket: string; prefix: string } {
  const normalized = dir.startsWith("/") ? dir : `/${dir}`;
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error(`Invalid object dir: ${dir}`);
  return { bucket: parts[0]!, prefix: parts.slice(1).join("/") };
}

function configuredDirs(): string[] {
  const dirs: string[] = [];
  const priv = process.env["PRIVATE_OBJECT_DIR"]?.trim();
  if (priv) dirs.push(priv);
  const pub = process.env["PUBLIC_OBJECT_SEARCH_PATHS"]?.trim();
  if (pub) {
    for (const p of pub.split(",").map((s) => s.trim()).filter(Boolean)) dirs.push(p);
  }
  if (dirs.length === 0) {
    throw new Error(
      "Neither PRIVATE_OBJECT_DIR nor PUBLIC_OBJECT_SEARCH_PATHS is set. " +
        "Run this inside the Replit shell where the Object Storage env vars exist.",
    );
  }
  return Array.from(new Set(dirs));
}

/** Keep downloads inside the output directory even if an object name contains "..". */
function safeJoin(root: string, ...segments: string[]): string {
  const target = path.resolve(root, ...segments);
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`Refusing to write outside output dir: ${segments.join("/")}`);
  }
  return target;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const storagePackageName = "@google-cloud" + "/storage";
  const { Storage } = (await import(storagePackageName)) as typeof import("@google-cloud/storage");

  const client = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });

  const dirs = configuredDirs();
  console.log(`Object dirs: ${dirs.join(", ")}`);

  const exported: ExportedObject[] = [];
  let totalBytes = 0;
  let failures = 0;

  // A single bucket can be listed under several configured prefixes; dedupe by
  // bucket + object name so an object is never downloaded twice.
  const seen = new Set<string>();

  for (const dir of dirs) {
    const { bucket: bucketName, prefix } = parseObjectDir(dir);
    const bucket = client.bucket(bucketName);
    const [files] = await bucket.getFiles(prefix ? { prefix } : {});
    console.log(`  ${dir} -> ${files.length} object(s)`);

    for (const file of files) {
      // Directory placeholder objects have no content worth keeping.
      if (file.name.endsWith("/")) continue;
      const key = `${bucketName}/${file.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const size = Number(file.metadata.size ?? 0);
      const localPath = safeJoin(args.out, bucketName, file.name);
      const record: ExportedObject = {
        bucket: bucketName,
        name: file.name,
        size,
        updated: (file.metadata.updated as string | undefined) ?? null,
        md5: (file.metadata.md5Hash as string | undefined) ?? null,
        localPath: path.relative(args.out, localPath),
      };

      if (args.dryRun) {
        exported.push(record);
        totalBytes += size;
        continue;
      }

      try {
        await mkdir(path.dirname(localPath), { recursive: true });
        // Stream rather than buffer: some card art is large and the Replit
        // container has a small memory ceiling.
        await pipeline(file.createReadStream(), createWriteStream(localPath));
        exported.push(record);
        totalBytes += size;
      } catch (err) {
        failures++;
        console.error(`  ! failed ${key}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    dirs,
    objectCount: exported.length,
    totalBytes,
    failures,
    objects: exported.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.name.localeCompare(b.name)),
  };

  if (!args.dryRun) {
    await mkdir(args.out, { recursive: true });
    await writeFile(path.join(args.out, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(
    `\n${args.dryRun ? "[dry run] would export" : "Exported"} ${exported.length} object(s), ${mb} MB` +
      (failures > 0 ? `, ${failures} failure(s)` : ""),
  );
  if (!args.dryRun) console.log(`Manifest: ${path.join(args.out, "manifest.json")}`);

  // A partial image export that reports success is how art goes missing
  // without anyone noticing until the migration is already done.
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
