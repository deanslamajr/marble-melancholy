/**
 * Firebase Hosting deployer that authenticates with the gcloud CLI instead of `firebase login`.
 * Reads the site and headers from firebase.json and the project from .firebaserc, so
 * `firebase deploy --only hosting` stays an equivalent alternative.
 *
 *   tsx tools/deploy/hosting.ts deploy           upload dist/ and release it
 *   tsx tools/deploy/hosting.ts domain <name>    attach a custom domain, print the DNS records
 *   tsx tools/deploy/hosting.ts status [<name>]  print the live release and domain/TLS state
 *
 * Set GCLOUD to the gcloud binary if it is not on PATH.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

const API = "https://firebasehosting.googleapis.com/v1beta1";
const ROOT = new URL("../../", import.meta.url).pathname;

interface FirebaseHeaderRule {
  source?: string;
  regex?: string;
  headers: { key: string; value: string }[];
}
interface FirebaseJson {
  hosting: { site: string; public: string; headers?: FirebaseHeaderRule[] };
}

const firebase = JSON.parse(readFileSync(join(ROOT, "firebase.json"), "utf8")) as FirebaseJson;
const project = (
  JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8")) as {
    projects: { default: string };
  }
).projects.default;
const site = firebase.hosting.site;

function token(): string {
  return execFileSync(process.env.GCLOUD ?? "gcloud", ["auth", "print-access-token"], {
    encoding: "utf8",
  }).trim();
}

let cachedToken: string | null = null;
async function api<T>(method: string, path: string, body?: unknown, okStatus: number[] = []) {
  cachedToken ??= token();
  const res = await fetch(path.startsWith("https://") ? path : `${API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cachedToken}`,
      "x-goog-user-project": project,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && !okStatus.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status}\n${await res.text()}`);
  }
  return { status: res.status, data: (res.status === 204 ? {} : await res.json()) as T };
}

async function ensureSite(): Promise<void> {
  const got = await api("GET", `projects/${project}/sites/${site}`, undefined, [404]);
  if (got.status !== 404) return;
  console.log(`Creating Hosting site ${site} in ${project}…`);
  try {
    await api("POST", `projects/${project}/sites?siteId=${site}`, {});
  } catch (e) {
    throw new Error(
      `${(e as Error).message}\nIf ${project} is not a Firebase project yet, add Firebase to it once at ` +
        `https://console.firebase.google.com/ (Create a project → "Add Firebase to Google Cloud project" → ${project}).`,
    );
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".")) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function servingHeaders() {
  return (firebase.hosting.headers ?? []).map((r) => ({
    ...(r.regex ? { regex: r.regex } : { glob: r.source }),
    headers: Object.fromEntries(r.headers.map((h) => [h.key, h.value])),
  }));
}

async function deploy(): Promise<void> {
  const publicDir = join(ROOT, firebase.hosting.public);
  const files = new Map<string, { path: string; gz: Buffer }>();
  for (const abs of walk(publicDir)) {
    const gz = gzipSync(readFileSync(abs), { level: 9 });
    const hash = createHash("sha256").update(gz).digest("hex");
    files.set(hash, { path: "/" + relative(publicDir, abs).split(sep).join("/"), gz });
  }
  if (![...files.values()].some((f) => f.path === "/index.html")) {
    throw new Error(`${publicDir}/index.html missing; run the build first`);
  }

  await ensureSite();
  const { data: version } = await api<{ name: string }>("POST", `sites/${site}/versions`, {
    config: { headers: servingHeaders() },
  });
  const manifest = Object.fromEntries([...files].map(([hash, f]) => [f.path, hash]));
  const { data: pop } = await api<{ uploadRequiredHashes?: string[]; uploadUrl: string }>(
    "POST",
    `${version.name}:populateFiles`,
    { files: manifest },
  );
  const needed = pop.uploadRequiredHashes ?? [];
  for (const hash of needed) {
    const f = files.get(hash)!;
    const res = await fetch(`${pop.uploadUrl}/${hash}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cachedToken}`,
        "x-goog-user-project": project,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(f.gz),
    });
    if (!res.ok) throw new Error(`upload ${f.path} → ${res.status}\n${await res.text()}`);
  }
  console.log(`Uploaded ${needed.length} of ${files.size} files.`);
  await api("PATCH", `${version.name}?updateMask=status`, { status: "FINALIZED" });
  const message = process.env.DEPLOY_MESSAGE ?? gitDescribe();
  await api("POST", `sites/${site}/releases?versionName=${version.name}`, { message });
  console.log(`Released ${version.name} (${message})`);
  console.log(`  https://${site}.web.app/`);
}

function gitDescribe(): string {
  try {
    return execFileSync("git", ["log", "-1", "--format=%h %s"], { encoding: "utf8" }).trim();
  } catch {
    return "deploy";
  }
}

interface DnsRecord {
  domainName: string;
  type: string;
  rdata: string;
  requiredAction?: string;
}
interface CustomDomain {
  hostState?: string;
  ownershipState?: string;
  reconciling?: boolean;
  cert?: { state?: string; type?: string };
  requiredDnsUpdates?: {
    checkTime?: string;
    desired?: { domainName: string; records?: DnsRecord[] }[];
  };
  issues?: { message?: string }[];
}

async function domain(name: string, create: boolean): Promise<void> {
  const path = `projects/${project}/sites/${site}/customDomains`;
  let got = await api<CustomDomain>("GET", `${path}/${name}`, undefined, [404]);
  if (got.status === 404) {
    if (!create) {
      console.log(`${name} is not attached to ${site}. Run: npm run deploy:domain -- ${name}`);
      return;
    }
    console.log(`Attaching ${name} to ${site}…`);
    await api("POST", `${path}?customDomainId=${name}`, {});
    await new Promise((r) => setTimeout(r, 5000));
    got = await api<CustomDomain>("GET", `${path}/${name}`);
  }
  const d = got.data;
  console.log(`${name}`);
  console.log(`  host: ${d.hostState ?? "?"}  ownership: ${d.ownershipState ?? "?"}`);
  console.log(`  certificate: ${d.cert?.state ?? "?"}${d.reconciling ? "  (reconciling)" : ""}`);
  for (const issue of d.issues ?? []) console.log(`  issue: ${issue.message}`);
  const records = (d.requiredDnsUpdates?.desired ?? []).flatMap((s) => s.records ?? []);
  if (records.length > 0) {
    console.log("  DNS records Firebase expects:");
    for (const r of records) {
      const action =
        r.requiredAction && r.requiredAction !== "NONE" ? `  [${r.requiredAction}]` : "";
      console.log(`    ${r.domainName}  ${r.type}  ${r.rdata}${action}`);
    }
  }
}

async function status(name?: string): Promise<void> {
  const { data } = await api<{
    releases?: { version: { name: string }; message?: string; releaseTime: string }[];
  }>("GET", `sites/${site}/releases?pageSize=1`);
  const r = data.releases?.[0];
  console.log(`https://${site}.web.app/`);
  console.log(
    r ? `  live: ${r.version.name} at ${r.releaseTime} (${r.message ?? ""})` : "  no releases",
  );
  if (name) await domain(name, false);
}

const [cmd = "deploy", arg] = process.argv.slice(2);
const run =
  cmd === "deploy"
    ? deploy()
    : cmd === "domain" && arg
      ? domain(arg, true)
      : cmd === "status"
        ? status(arg)
        : Promise.reject(new Error("usage: hosting.ts deploy | domain <name> | status [<name>]"));
run.catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
