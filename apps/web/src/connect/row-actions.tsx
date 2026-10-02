import type { OverviewConnection } from "../api.ts";
import { CloseIcon, DotsIcon, PauseIcon, PencilIcon, PlayIcon, UnplugIcon } from "../icons.tsx";
import { Button, ButtonLink } from "../ui/button.tsx";
import { Menu, MenuItem } from "../ui/menu.tsx";

export interface RowHandlers {
  readonly onPause: (connection: OverviewConnection, paused: boolean) => void;
  readonly onRename: (connection: OverviewConnection) => void;
  readonly onRemove: (connection: OverviewConnection) => void;
}

function reconnectHref(id: string): string {
  return `#/reconnect/${encodeURIComponent(id)}`;
}

/** One contextual button, then the "more" menu. Disconnected rows can only be renamed or removed. */
export function RowActions(props: {
  readonly connection: OverviewConnection;
  readonly name: string;
  readonly busy: boolean;
  readonly handlers: RowHandlers;
}) {
  const { connection, handlers } = props;
  const disconnected = connection.state === "reconnect_required";
  const paused = connection.state === "paused";
  return (
    <span className="acts">
      {disconnected ? (
        <ButtonLink
          variant="primary"
          size="sm"
          href={reconnectHref(connection.id)}
          icon={<UnplugIcon />}
        >
          Reconnect
        </ButtonLink>
      ) : null}
      {paused ? (
        <Button
          size="sm"
          icon={<PlayIcon />}
          busy={props.busy}
          busyLabel="Resuming"
          onClick={() => handlers.onPause(connection, false)}
        >
          Resume
        </Button>
      ) : null}
      <Menu
        variant="row"
        label={`More actions for ${props.name}`}
        trigger={<DotsIcon />}
        triggerClassName="btn quiet sm kebab"
      >
        {disconnected ? null : (
          <MenuItem
            icon={paused ? <PlayIcon /> : <PauseIcon />}
            onSelect={() => handlers.onPause(connection, !paused)}
          >
            {paused ? "Resume" : "Pause"}
          </MenuItem>
        )}
        {disconnected ? null : (
          <MenuItem
            icon={<UnplugIcon />}
            onSelect={() => {
              window.location.hash = reconnectHref(connection.id);
            }}
          >
            Reconnect
          </MenuItem>
        )}
        <MenuItem icon={<PencilIcon />} onSelect={() => handlers.onRename(connection)}>
          Rename
        </MenuItem>
        <MenuItem danger icon={<CloseIcon />} onSelect={() => handlers.onRemove(connection)}>
          {disconnected ? "Remove" : "Disconnect"}
        </MenuItem>
      </Menu>
    </span>
  );
}
