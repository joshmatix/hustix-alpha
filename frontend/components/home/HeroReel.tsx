const slides = [
  { src: '/hero/portfolio.png', side: 'left' },
  { src: '/hero/stress.png', side: 'right' },
  { src: '/hero/montecarlo.png', side: 'left' },
  { src: '/hero/client-report.png', side: 'right' },
  { src: '/hero/advisor-report.png', side: 'left' },
  { src: '/hero/portfolio.png', side: 'left' },
];

/** Slow slide through one account's portfolio, stress test, Monte Carlo, and reports. */
export default function HeroReel() {
  return (
    <div className="flex h-full w-[600%] animate-hero-reel">
      {slides.map((slide, index) => (
        <img
          key={`${slide.src}-${index}`}
          src={slide.src}
          alt=""
          className={`h-full w-[16.666%] object-cover ${slide.side === 'left' ? 'object-left' : 'object-right'}`}
        />
      ))}
    </div>
  );
}
