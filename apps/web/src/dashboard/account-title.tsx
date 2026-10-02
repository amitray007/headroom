import { useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { CheckIcon, PencilIcon } from "../icons.tsx";

const maxName = 40;
const savedMs = 1600;

/**
 * Account name, plan, rename pencil and the identity line. The pencil turns the name into a field:
 * Enter saves, Escape cancels, leaving the field saves, and a blank name goes back to the default.
 */
export function AccountTitle(props: {
  readonly id: string;
  readonly headingId: string;
  /** What is shown now: the owner's name, else the default word. */
  readonly name: string;
  /** The owner-set name, null when none is set. */
  readonly custom: string | null;
  readonly plan: string | null;
  readonly identity: string | null;
  readonly onRenamed: () => Promise<void>;
}) {
  const { id, name, custom, onRenamed } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const live = useRef(true);
  const alive = (): boolean => live.current;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), savedMs);
    return () => clearTimeout(timer);
  }, [saved]);

  const start = (): void => {
    finished.current = false;
    setDraft(name);
    setEditing(true);
  };
  const finish = async (save: boolean): Promise<void> => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (!save) return;
    const next = draft.trim();
    if (next === (custom ?? "") || (custom === null && next === name)) return;
    try {
      await api.rename(id, next === "" ? null : next);
      await onRenamed();
      if (alive()) setSaved(true);
    } catch {
      // The name stays as it was; the next load shows the truth.
    }
  };

  return (
    <div className="titles">
      <h3 id={props.headingId}>
        {editing ? (
          <input
            ref={input}
            className="name-edit"
            aria-label="Account name"
            maxLength={maxName}
            value={draft}
            style={{ width: `${Math.max(6, draft.length + 2)}ch` }}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void finish(true);
              if (event.key === "Escape") void finish(false);
            }}
            onBlur={() => void finish(true)}
          />
        ) : (
          <span className="name">{name}</span>
        )}
        {props.plan === null ? null : (
          <span className="plan">
            <span className="sep" aria-hidden="true">
              ·
            </span>
            {props.plan}
          </span>
        )}
        {editing ? null : (
          <button className="rename" type="button" aria-label="Rename this account" onClick={start}>
            <PencilIcon />
          </button>
        )}
        {saved ? (
          <output className="saved">
            <CheckIcon /> Saved
          </output>
        ) : null}
      </h3>
      {props.identity === null ? null : (
        <div className="ident">
          <span className="who">{props.identity}</span>
        </div>
      )}
    </div>
  );
}
