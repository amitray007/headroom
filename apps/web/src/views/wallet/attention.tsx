import { AlertIcon, BrandMark } from "../../icons.tsx";
import { accountName, providerName } from "@headroom/view-model/labels";

import { Button } from "../../ui/button.tsx";
import { Popover, useCloseLayer } from "../../ui/menu.tsx";
import type { AttentionItem } from "./attention-items.ts";

function Row(props: { readonly item: AttentionItem }) {
  const { item } = props;
  const close = useCloseLayer();
  const who = item.connection === undefined ? null : accountName(item.connection);
  return (
    <li>
      {item.connection === undefined ? <span /> : <BrandMark provider={item.connection.provider} />}
      <span className="w-attn-text">
        <span className="w-attn-name">
          {item.connection === undefined ? (
            "Removed account"
          ) : (
            <>
              {providerName(item.connection.provider)}
              {who === null ? null : (
                <>
                  {" · "}
                  <span className={who.includes("@") ? "who" : undefined}>{who}</span>
                </>
              )}
            </>
          )}
        </span>
        <span className="w-attn-issue">{item.issue}</span>
      </span>
      {item.fix === undefined ? null : (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            close();
            item.fix?.run();
          }}
        >
          {item.fix.label}
        </Button>
      )}
    </li>
  );
}

/**
 * An attention icon beside a stat's label. Hover or focus opens the exact list of what the figure leaves out, each
 * with its fix. Renders nothing when nothing needs attention.
 */
export function Attention(props: {
  readonly title: string;
  readonly items: readonly AttentionItem[];
}) {
  const { items } = props;
  if (items.length === 0) return null;
  const count = `${items.length} ${items.length === 1 ? "item needs" : "items need"} attention`;
  return (
    <Popover
      label={`${props.title}: ${count}`}
      panelLabel={`${props.title}: ${count}`}
      panelClassName="notif w-attn-pop"
      triggerClassName="w-attn-trigger"
      trigger={<AlertIcon />}
      openOnHover
    >
      <p className="w-attn-head">
        <span>{props.title}</span>
        <span>{count}</span>
      </p>
      <ul className="w-attn-list">
        {items.map((item) => (
          <Row key={item.key} item={item} />
        ))}
      </ul>
    </Popover>
  );
}
