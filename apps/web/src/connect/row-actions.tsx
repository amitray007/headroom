import type { OverviewConnection } from "../api.ts";
import { CloseIcon, DotsIcon, PauseIcon, PencilIcon, PlayIcon, UnplugIcon } from "../icons.tsx";
import { Menu, MenuItem } from "../ui/menu.tsx";
import { SplitButton } from "../ui/split-button.tsx";

export interface RowHandlers {
  readonly onPause: (connection: OverviewConnection, paused: boolean) => void;
  readonly onRename: (connection: OverviewConnection) => void;
  readonly onRemove: (connection: OverviewConnection) => void;
}

function reconnectHref(id: string): string {
  return `#/reconnect/${encodeURIComponent(id)}`;
}

/**
 * A disconnected or paused row leads with its contextual action (Reconnect, Resume) as a split button whose
 * menu holds the rest. Other rows keep only the "more" menu. Disconnect and Remove always confirm first.
 */
export function RowActions(props: {
  readonly connection: OverviewConnection;
  readonly name: string;
  readonly busy: boolean;
  readonly handlers: RowHandlers;
}) {
  const { connection, handlers } = props;
  const disconnected = connection.state === "reconnect_required";
  const paused = connection.state === "paused";
  const rename = (
    <MenuItem icon={<PencilIcon />} onSelect={() => handlers.onRename(connection)}>
      Rename
    </MenuItem>
  );
  const remove = (
    <MenuItem danger icon={<CloseIcon />} onSelect={() => handlers.onRemove(connection)}>
      {disconnected ? "Remove" : "Disconnect"}
    </MenuItem>
  );
  const menuLabel = `More actions for ${props.name}`;
  return (
    <span className="acts">
      {disconnected ? (
        <SplitButton
          variant="primary"
          size="sm"
          href={reconnectHref(connection.id)}
          icon={<UnplugIcon />}
          label="Reconnect"
          menuLabel={menuLabel}
        >
          {rename}
          {remove}
        </SplitButton>
      ) : paused ? (
        <SplitButton
          size="sm"
          icon={<PlayIcon />}
          label="Resume"
          busy={props.busy}
          busyLabel="Resuming"
          onClick={() => handlers.onPause(connection, false)}
          menuLabel={menuLabel}
        >
          <MenuItem
            icon={<UnplugIcon />}
            onSelect={() => {
              window.location.hash = reconnectHref(connection.id);
            }}
          >
            Reconnect
          </MenuItem>
          {rename}
          {remove}
        </SplitButton>
      ) : (
        <Menu
          variant="row"
          label={menuLabel}
          trigger={<DotsIcon />}
          triggerClassName="btn quiet sm kebab"
        >
          <MenuItem icon={<PauseIcon />} onSelect={() => handlers.onPause(connection, true)}>
            Pause
          </MenuItem>
          <MenuItem
            icon={<UnplugIcon />}
            onSelect={() => {
              window.location.hash = reconnectHref(connection.id);
            }}
          >
            Reconnect
          </MenuItem>
          {rename}
          {remove}
        </Menu>
      )}
    </span>
  );
}
