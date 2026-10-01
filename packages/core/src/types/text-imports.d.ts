/** Bun bundles `import x from "./file.sql" with { type: "text" }` as a string. */
declare module "*.sql" {
  const text: string;
  export default text;
}
