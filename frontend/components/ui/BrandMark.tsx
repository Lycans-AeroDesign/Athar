import { Icon } from "./Icon";

// Simple brand mark - the Stitch reference designs hotlink a generated
// placeholder image from Google's temp CDN, which isn't safe to depend on
// for real product code, so this renders an equivalent mark inline instead.
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-primary text-on-primary ${className ?? ""}`}
    >
      <Icon name="hub" filled />
    </div>
  );
}
