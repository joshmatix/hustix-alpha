const slides = [
  {
    src: '/hero/portfolio.png',
    side: 'left',
    alt: 'Hustix Macro - Client Portfolio and Asset Allocation',
  },
  {
    src: '/hero/stress.png',
    side: 'right',
    alt: 'Hustix Macro - Stagflation Stress Test Results',
  },
  {
    src: '/hero/montecarlo.png',
    side: 'left',
    alt: 'Hustix Macro - Monte Carlo Portfolio Stress Test Report',
  },
  {
    src: '/hero/client-report.png',
    side: 'right',
    alt: 'Hustix Macro - Client Stress Test Report',
  },
  {
    src: '/hero/advisor-report.png',
    side: 'left',
    alt: 'Hustix Macro - Advisor Stress Test Report',
  },
  {
    src: '/hero/portfolio.png',
    side: 'left',
    alt: '',
    duplicate: true,
  },
];

/** Slow slide through one account's portfolio, stress test, Monte Carlo, and reports. */
export default function HeroReel() {
  return (
    <div className="flex h-full w-[600%] animate-hero-reel">
      {slides.map((slide, index) => (
        <div
          key={`${slide.src}-${index}`}
          className="h-full w-[16.666%] overflow-hidden"
          aria-hidden={slide.duplicate || undefined}
        >
          <img
            src={slide.src}
            alt={slide.alt}
            className={`h-full w-full object-cover ${
              slide.side === 'left'
                ? 'origin-left object-left scale-[2.05]'
                : 'origin-right object-right scale-[2.05]'
            }`}
          />
        </div>
      ))}
    </div>
  );
}
