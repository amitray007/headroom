/**
 * Checks that this server still works with every supported Mac release (D47).
 *
 * Each `macos-vX.Y.Z` tag holds the contract that release was built from. The server's own
 * schemas, with every enum closed, must still satisfy each one: the server keeps every endpoint
 * the app calls, keeps sending every field it requires, never sends a type or a value it does not
 * know, and still accepts every request it makes. Releases older than `oldestSupportedMac` in
 * apps/macos/Contract/compatibility.json are no longer checked.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { serverSchemas } from "./app-contract.ts";

type Schema = Record<string, unknown>;
type Document = {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Schema };
};

const policyPath = fileURLToPath(
  new URL("../apps/macos/Contract/compatibility.json", import.meta.url),
);
const contractFile = "apps/macos/Contract/openapi.json";

const object = (value: unknown): Schema =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Schema) : {};

function types(schema: Schema): Set<string> {
  const type = schema["type"];
  const list = Array.isArray(type) ? type : typeof type === "string" ? [type] : [];
  return new Set(list.map(String));
}

function resolve(schema: Schema, components: Schema): Schema {
  const ref = schema["$ref"];
  if (typeof ref !== "string") return schema;
  return object(components[ref.replace("#/components/schemas/", "")]);
}

/** A type the app accepts: an integer is also a number. */
function accepts(app: Set<string>, sent: string): boolean {
  return app.has(sent) || (sent === "integer" && app.has("number"));
}

/**
 * The server sends `sent`; the old app decodes it with `app`. Every difference that would make
 * that decode fail is a problem.
 */
function compareResponse(app: Schema, sent: Schema, where: string, problems: string[]): void {
  const appTypes = types(app);
  const sentTypes = types(sent);
  if (appTypes.size > 0)
    for (const type of sentTypes)
      if (!accepts(appTypes, type))
        problems.push(`${where}: sends ${type}, which the app cannot read`);
  const appEnum = app["enum"];
  if (Array.isArray(appEnum)) {
    const sentEnum = sent["enum"];
    if (!Array.isArray(sentEnum)) problems.push(`${where}: sends values outside the app's list`);
    else
      for (const value of sentEnum)
        if (!appEnum.includes(value))
          problems.push(`${where}: sends ${JSON.stringify(value)}, which the app does not know`);
  }
  const appRequired = Array.isArray(app["required"]) ? app["required"].map(String) : [];
  const sentRequired = new Set(Array.isArray(sent["required"]) ? sent["required"].map(String) : []);
  for (const name of appRequired)
    if (!sentRequired.has(name))
      problems.push(`${where}.${name}: required by the app, not always sent`);
  const appProperties = object(app["properties"]);
  const sentProperties = object(sent["properties"]);
  for (const [name, schema] of Object.entries(appProperties))
    if (name in sentProperties)
      compareResponse(object(schema), object(sentProperties[name]), `${where}.${name}`, problems);
  if ("items" in app && "items" in sent)
    compareResponse(object(app["items"]), object(sent["items"]), `${where}[]`, problems);
}

/** The old app sends `app`; the server validates with `server`. */
function compareRequest(app: Schema, server: Schema, where: string, problems: string[]): void {
  const appTypes = types(app);
  const serverTypes = types(server);
  if (serverTypes.size > 0)
    for (const type of appTypes)
      if (!accepts(serverTypes, type)) problems.push(`${where}: no longer accepts ${type}`);
  const serverEnum = server["enum"];
  const appEnum = app["enum"];
  if (Array.isArray(serverEnum) && Array.isArray(appEnum))
    for (const value of appEnum)
      if (!serverEnum.includes(value))
        problems.push(`${where}: no longer accepts ${JSON.stringify(value)}`);
  const appProperties = object(app["properties"]);
  const serverRequired = Array.isArray(server["required"]) ? server["required"].map(String) : [];
  for (const name of serverRequired)
    if (!(name in appProperties))
      problems.push(`${where}.${name}: now required, the app never sends it`);
  const serverProperties = object(server["properties"]);
  for (const [name, schema] of Object.entries(appProperties))
    if (name in serverProperties)
      compareRequest(object(schema), object(serverProperties[name]), `${where}.${name}`, problems);
  if ("items" in app && "items" in server)
    compareRequest(object(app["items"]), object(server["items"]), `${where}[]`, problems);
}

function bodySchema(value: unknown): Schema {
  return object(object(object(object(value)["content"])["application/json"])["schema"]);
}

/**
 * Every way `server` (the current paths and server schemas) breaks an app built from `app`.
 * Paths come from the current contract; schemas are the server's, with enums closed.
 */
export function compatibilityProblems(app: Document, server: Document): string[] {
  const problems: string[] = [];
  const appSchemas = object(app.components?.schemas);
  const serverComponents = object(server.components?.schemas);
  for (const [path, methods] of Object.entries(app.paths ?? {})) {
    const serverMethods = object(server.paths?.[path]);
    for (const [method, operation] of Object.entries(object(methods))) {
      const where = `${method.toUpperCase()} ${path}`;
      const serverOperation = object(serverMethods[method]);
      if (Object.keys(serverOperation).length === 0) {
        problems.push(`${where}: removed`);
        continue;
      }
      const appResponse = bodySchema(object(object(operation)["responses"])["200"]);
      const serverResponse = bodySchema(object(serverOperation["responses"])["200"]);
      if (Object.keys(appResponse).length > 0)
        compareResponse(
          resolve(appResponse, appSchemas),
          resolve(serverResponse, serverComponents),
          where,
          problems,
        );
      const appRequest = bodySchema(object(operation)["requestBody"]);
      const serverRequest = bodySchema(serverOperation["requestBody"]);
      if (Object.keys(appRequest).length > 0)
        compareRequest(
          resolve(appRequest, appSchemas),
          resolve(serverRequest, serverComponents),
          `${where} body`,
          problems,
        );
    }
  }
  return problems;
}

function release(version: string): number[] {
  return version.split(".").map(Number);
}

function atLeast(version: string, floor: string): boolean {
  const [a, b] = [release(version), release(floor)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** Supported Mac releases and the contract each was built from. */
async function supportedReleases(): Promise<{ version: string; contract: Document }[]> {
  const policy = JSON.parse(await readFile(policyPath, "utf8")) as { oldestSupportedMac: string };
  const tags = git("tag", "--list", "macos-v*").split("\n").filter(Boolean);
  const releases: { version: string; contract: Document }[] = [];
  for (const tag of tags) {
    const version = tag.replace("macos-v", "");
    if (!/^\d+\.\d+\.\d+$/.test(version) || !atLeast(version, policy.oldestSupportedMac)) continue;
    let text: string;
    try {
      text = git("show", `${tag}:${contractFile}`);
    } catch {
      continue;
    }
    releases.push({ version, contract: JSON.parse(text) as Document });
  }
  return releases;
}

if (import.meta.main) {
  const current = JSON.parse(
    await readFile(fileURLToPath(new URL(`../${contractFile}`, import.meta.url)), "utf8"),
  ) as Document;
  const server: Document = { paths: current.paths, components: { schemas: serverSchemas() } };
  const releases = await supportedReleases();
  let failed = false;
  for (const { version, contract } of releases) {
    const problems = compatibilityProblems(contract, server);
    if (problems.length === 0) continue;
    failed = true;
    console.error(`Breaks Headroom for Mac ${version}:`);
    for (const problem of problems) console.error(`  ${problem}`);
  }
  if (failed) {
    console.error(
      "Keep the change additive, open the field in scripts/app-contract.ts, or move it to /api/app/v2. See .agents/skills/app-api-compatibility/SKILL.md.",
    );
    process.exit(1);
  }
  console.log(`Compatible with ${releases.length} supported Mac release(s).`);
}
