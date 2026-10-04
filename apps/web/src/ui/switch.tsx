/** An on or off switch (42 by 24). Give it a `label`, or wrap it in a `<label>` that names it. */
export function Switch(props: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label?: string;
  readonly id?: string;
  readonly disabled?: boolean;
}) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        id={props.id}
        role="switch"
        aria-checked={props.checked}
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.label}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span className="track">
        <span className="thumb" />
      </span>
    </span>
  );
}
