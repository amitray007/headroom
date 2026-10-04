import init from "./0000_init.sql" with { type: "text" };
import namesAndSettings from "./0001_names_and_settings.sql" with { type: "text" };
import displayOrder from "./0002_display_order.sql" with { type: "text" };
import notificationDelivery from "./0003_notification_delivery.sql" with { type: "text" };
import wallet from "./0004_wallet.sql" with { type: "text" };
import singleOwner from "./0005_single_owner.sql" with { type: "text" };
import automations from "./0006_automations.sql" with { type: "text" };

/** Ordered migrations, embedded as text so the compiled binary carries them. */
export const migrationFiles: readonly { readonly name: string; readonly sql: string }[] = [
  { name: "0000_init", sql: init },
  { name: "0001_names_and_settings", sql: namesAndSettings },
  { name: "0002_display_order", sql: displayOrder },
  { name: "0003_notification_delivery", sql: notificationDelivery },
  { name: "0004_wallet", sql: wallet },
  { name: "0005_single_owner", sql: singleOwner },
  { name: "0006_automations", sql: automations },
];
