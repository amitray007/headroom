import init from "./0000_init.sql" with { type: "text" };
import namesAndSettings from "./0001_names_and_settings.sql" with { type: "text" };

/** Ordered migrations, embedded as text so the compiled binary carries them. */
export const migrationFiles: readonly { readonly name: string; readonly sql: string }[] = [
  { name: "0000_init", sql: init },
  { name: "0001_names_and_settings", sql: namesAndSettings },
];
