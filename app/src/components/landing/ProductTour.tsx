import { useState } from 'react';
import { ArrowUpRight } from '@phosphor-icons/react';

const SCREENS = [
  { id: 'result', desktopHeight: 634, mobileHeight: 751, label: 'Get a result', title: 'A useful result. Not just another reply.',
    description: 'Ask: “Compare these three supplier quotes.” Review the comparison and open the file Jentera prepared.',
    alt: 'Jentera task result comparing three fictional packaging suppliers, with a supplier-comparison.csv file.' },
  { id: 'activity', desktopHeight: 939, mobileHeight: 1162, label: 'Follow the work', title: 'See what finished. Know what needs you.',
    description: 'Keep track of completed work, work in progress, and tasks waiting for a decision in one place.',
    alt: 'Work history showing a completed supplier comparison, a follow-up awaiting approval, and a stock checklist in progress.' },
  { id: 'approval', desktopHeight: 228, mobileHeight: 249, label: 'Stay in control', title: 'A clear decision before the next step.',
    description: 'When a task needs permission, inspect the proposed action and choose whether Jentera should proceed.',
    alt: 'A Jentera approval card showing a proposed command to prepare a supplier follow-up, with allow and deny controls.' },
  { id: 'knowledge', desktopHeight: 439, mobileHeight: 543, label: 'Teach your business', title: 'Your confirmed details stay the source of truth.',
    description: 'Review what Jentera learns. Accept a suggested update or discard it while keeping the current confirmed value.',
    alt: 'Business knowledge with confirmed opening hours and a suggested price update beside the current RM 100 value.' },
] as const;

export function ProductTour() {
  const [selected, setSelected] = useState(0);
  const screen = SCREENS[selected];
  const base = `/images/product-tour/${screen.id}`;
  return (
    <section id="product-tour" className="lp-section lp-container lp-product-tour" aria-labelledby="product-tour-heading">
      <div className="lp-section-heading">
        <span className="lp-eyebrow">Inside Jentera</span>
        <h2 id="product-tour-heading">From a job to a result.</h2>
        <p>A closer look at the workspace you’ll use. Actual product screens, with fictional demo content—not customer results.</p>
      </div>
      <div className="lp-tour-choices" role="group" aria-label="Choose a product screenshot">
        {SCREENS.map((item, index) => (
          <button type="button" key={item.id} aria-pressed={selected === index}
            aria-controls="product-tour-screen" onClick={() => setSelected(index)}>
            <span aria-hidden="true">0{index + 1}</span>{item.label}
          </button>
        ))}
      </div>
      <figure id="product-tour-screen" className="lp-tour-frame">
        <figcaption aria-live="polite" aria-atomic="true">
          <span className="lp-tour-demo">Demo workspace · fictional data</span>
          <h3>{screen.title}</h3>
          <p>{screen.description}</p>
          <a href={`${base}-desktop-v1.png`} target="_blank" rel="noopener noreferrer">
            Open full-size screenshot <span className="sr-only">(opens in a new tab)</span><ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </figcaption>
        <div className="lp-tour-image">
          <picture key={screen.id}>
            <source media="(max-width: 600px)" srcSet={`${base}-mobile-v1.png`} width={366} height={screen.mobileHeight} />
            <img src={`${base}-desktop-v1.png`} width={828} height={screen.desktopHeight} alt={screen.alt} loading="lazy" decoding="async" />
          </picture>
        </div>
      </figure>
    </section>
  );
}
