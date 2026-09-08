/** Shared identity, from the browser tab to the owner's workspace. */
export function JenteraMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      className={`jentera-mark ${className}`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
