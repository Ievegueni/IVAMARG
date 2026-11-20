// Símbolo do logótipo Ivamarg (redesenhado em SVG, sem o fundo da imagem original).
export function LogoMark({ className, diamond }: { className: string; diamond: string }) {
  return (
    <svg viewBox="480 0 840 460" className={className} aria-hidden>
      <rect x="493" y="226" width="812" height="14" fill="#ff0a8c" />
      <path d="M735 68 900 233 735 398 570 233Z M1065 68 1230 233 1065 398 900 233Z" fill="#ff0a8c" />
      <path d="M900 15 1118 233 900 451 682 233Z" fill={diamond} />
    </svg>
  );
}
