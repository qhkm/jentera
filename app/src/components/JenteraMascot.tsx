/** Decorative character for greetings and Jentera's own messages. */
export function JenteraMascot({ size = 36, className = '' }: { size?: number; className?: string }) {
  return <img
    className={`jentera-mascot ${className}`}
    src="/images/jentera-character-glossy-v1.webp"
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    draggable={false}
  />;
}
