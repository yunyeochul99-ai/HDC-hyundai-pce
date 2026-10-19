import logoUrl from './assets/hdc-hyundai-pce.svg';

/** Outlined vector artwork from the company's supplied CI master. */
export default function BrandLogo({className = ''}: {className?: string}) {
  return <img className={`brand-logo ${className}`.trim()} src={logoUrl} alt="HDC 현대PCE" width="609" height="85" decoding="async" />;
}
