import type { ReactNode } from 'react';

/** A conversational presentation layer for deterministic onboarding steps.
 * The character is decorative; the speaker name and message remain normal,
 * selectable HTML so the flow is usable without the image. */
export function OnboardingGuide({ children, compact = false }: {
  children: ReactNode;
  compact?: boolean;
}) {
  return <section className={`onboarding-guide${compact ? ' is-compact' : ''}`} aria-label="Jentera">
    <div className="onboarding-guide__portrait" aria-hidden="true">
      <img src="/images/jentera-character-glossy-v1.webp" alt="" width={112} height={112} draggable={false} />
    </div>
    <div className="onboarding-guide__message">
      <span className="onboarding-guide__speaker">Jentera</span>
      {children}
    </div>
  </section>;
}

export function OnboardingAnswer({ children, speaker = 'You' }: { children: ReactNode; speaker?: string }) {
  return <div className="onboarding-answer">
    <span className="onboarding-answer__speaker">{speaker}</span>
    <div>{children}</div>
  </div>;
}
