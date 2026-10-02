/** A success tick that draws itself from its short stroke. The animation lives in buttons.css. */
export function DrawnCheck() {
  return (
    <svg
      className="drawn-check"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 12l5 5L20 6" pathLength="1" />
    </svg>
  );
}
