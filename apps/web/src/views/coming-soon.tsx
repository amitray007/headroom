import { LoadingNote, Sk } from "../ui/skeleton.tsx";

/** Stands in for a view that is not built yet: a skeleton in the final frame and one plain line. */
export function ComingSoon(props: { readonly title: string }) {
  return (
    <div className="reveal" aria-busy="true">
      <LoadingNote>{`${props.title} is coming soon`}</LoadingNote>
      <Sk kind="title" width={160} />
      <Sk kind="block" height={220} />
      <p className="muted">Coming soon</p>
    </div>
  );
}
