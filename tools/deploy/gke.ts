/**
 * Beta deployment to the GKE cluster that also serves llmgag.
 *
 *   tsx tools/deploy/gke.ts deploy   build + push the image, apply deploy/k8s/marble.yaml, wait for rollout
 *   tsx tools/deploy/gke.ts status   rollout, route, Gateway, certificate, DNS and HTTPS state
 *
 * `deploy` expects dist/ to be built (`npm run deploy` builds first). Env overrides: GCLOUD (gcloud
 * binary), KUBE_CONTEXT, IMAGE_REPO.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { resolve4 } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const PROJECT = "development-262721";
const HOST = "marble.llmgag.world";
const NAMESPACE = "marble-melancholy";
const CERT = "marble-llmgag-world";
const CERT_MAP = "dslama-net-map";
const GATEWAY_IP = "34.117.49.14";
const CONTEXT = process.env.KUBE_CONTEXT ?? "gke_development-262721_us-central1-a_cluster-1";
const IMAGE_REPO =
  process.env.IMAGE_REPO ?? `us-central1-docker.pkg.dev/${PROJECT}/marble-melancholy/web`;
const GCLOUD = process.env.GCLOUD ?? "gcloud";

function out(cmd: string, args: string[], input?: string): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", input }).trim();
}

function run(cmd: string, args: string[], input?: string): void {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    input,
    stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

function tryOut(cmd: string, args: string[]): string | null {
  try {
    return out(cmd, args);
  } catch {
    return null;
  }
}

const kubectl = (...args: string[]) => ["--context", CONTEXT, "--request-timeout=30s", ...args];

function imageTag(): string {
  const sha = out("git", ["rev-parse", "--short", "HEAD"]);
  if (out("git", ["status", "--porcelain"]) === "") return sha;
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${sha}-dirty-${stamp}`;
}

function deploy(): void {
  if (!existsSync(join(ROOT, "dist/index.html")))
    throw new Error("dist/ missing; run npm run build");
  const image = `${IMAGE_REPO}:${imageTag()}`;
  console.log(`\n▶ Building and pushing ${image}`);
  run("docker", [
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--provenance=false",
    "--sbom=false",
    "--tag",
    image,
    "--push",
    ".",
  ]);
  const manifest = readFileSync(join(ROOT, "deploy/k8s/marble.yaml"), "utf8");
  if (!manifest.includes("image: IMAGE"))
    throw new Error("image placeholder missing in marble.yaml");
  console.log(`\n▶ Applying deploy/k8s/marble.yaml to ${CONTEXT}`);
  run("kubectl", kubectl("apply", "-f", "-"), manifest.replace("image: IMAGE", `image: ${image}`));
  run(
    "kubectl",
    kubectl("-n", NAMESPACE, "rollout", "status", "deployment/marble", "--timeout=180s"),
  );
  console.log(
    `\nDeployed ${image}\nRun npm run deploy:status to check the route, certificate and DNS.`,
  );
}

async function status(): Promise<void> {
  const line = (k: string, v: string) => console.log(`${k.padEnd(12)} ${v}`);
  const ready = tryOut(
    "kubectl",
    kubectl(
      "-n",
      NAMESPACE,
      "get",
      "deployment/marble",
      "-o",
      "jsonpath={.status.readyReplicas}/{.spec.replicas} {.spec.template.spec.containers[0].image}",
    ),
  );
  line("deployment", ready ?? "not found");

  const route = tryOut(
    "kubectl",
    kubectl(
      "-n",
      NAMESPACE,
      "get",
      "httproute/marble-llmgag-world",
      "-o",
      "jsonpath={range .status.parents[*].conditions[*]}{.type}={.status} {end}",
    ),
  );
  line("route", route || "no status");
  const gw = tryOut(
    "kubectl",
    kubectl(
      "-n",
      "default",
      "get",
      "gateway/external-https",
      "-o",
      'jsonpath={.status.conditions[?(@.type=="Programmed")].status} {.status.conditions[?(@.type=="Programmed")].message}',
    ),
  );
  line("gateway", gw ? `Programmed=${gw}` : "unknown");
  const urlMap = tryOut(
    "kubectl",
    kubectl(
      "-n",
      "default",
      "get",
      "gateway/external-https",
      "-o",
      "jsonpath={.metadata.annotations.networking\\.gke\\.io/url-maps}",
    ),
  );
  if (urlMap) {
    const hosts = tryOut(GCLOUD, [
      "compute",
      "url-maps",
      "describe",
      urlMap.split("/").pop()!,
      "--global",
      `--project=${PROJECT}`,
      "--format=value(hostRules[].hosts)",
    ]);
    line(
      "lb host",
      hosts?.includes(HOST)
        ? `${HOST} is in the load balancer URL map`
        : `${HOST} is NOT in the load balancer URL map yet`,
    );
  }

  const cert = tryOut(GCLOUD, [
    "certificate-manager",
    "certificates",
    "describe",
    CERT,
    `--project=${PROJECT}`,
    "--format=value(managed.state,managed.provisioningIssue.reason,managed.authorizationAttemptInfo[].state)",
  ]);
  line("certificate", cert ?? "not found");
  const entry = tryOut(GCLOUD, [
    "certificate-manager",
    "maps",
    "entries",
    "describe",
    `${CERT}-map-entry`,
    `--map=${CERT_MAP}`,
    `--project=${PROJECT}`,
    "--format=value(state)",
  ]);
  line("cert map", entry ? `${CERT_MAP} entry ${entry}` : "entry not found");

  const ips = await resolve4(HOST).catch(() => [] as string[]);
  line(
    "dns",
    ips.length
      ? `${HOST} → ${ips.join(", ")}${ips.includes(GATEWAY_IP) ? "" : ` (expected ${GATEWAY_IP})`}`
      : `${HOST} does not resolve (add A ${GATEWAY_IP})`,
  );
  if (ips.length) {
    const res = await fetch(`https://${HOST}/`, { method: "HEAD" }).catch((e: Error) => e);
    line(
      "https",
      res instanceof Error
        ? `${res.message} ${(res.cause as Error | undefined)?.message ?? ""}`
        : `${res.status} cache-control: ${res.headers.get("cache-control")}`,
    );
  }
}

const cmd = process.argv[2] ?? "status";
try {
  if (cmd === "deploy") deploy();
  else if (cmd === "status") await status();
  else throw new Error("usage: gke.ts deploy | status");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
