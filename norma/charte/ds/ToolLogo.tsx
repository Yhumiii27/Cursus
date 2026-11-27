// Logos des outils de la suite (Norma 2.3.0, charte/logos/<code>.svg, validés par le propriétaire le 25 novembre 2026 ; Ingenium ajouté en 3.1.0).
// Fichier généré depuis les SVG de charte/logos : les modifier là, jamais ici. Une tuile de 64 × 64 (dégradé propre à l'outil,
// glyphe blanc), affichée dans la marque de la barre latérale et de la barre supérieure (COQUE.md § 2) ; le SVG lui-même sert
// de favicon (src/app/icon.svg de l'outil).
import { useId, type ReactElement } from 'react';

export type ToolCode = 'arche' | 'clavis' | 'codex' | 'crucible' | 'cursus' | 'ingenium' | 'keystone' | 'matrix' | 'modulus' | 'vector' | 'vigie';

export const TOOL_CODES: readonly ToolCode[] = ['arche', 'clavis', 'codex', 'crucible', 'cursus', 'ingenium', 'keystone', 'matrix', 'modulus', 'vector', 'vigie'];

export interface ToolLogoProps {
  /** Code of the tool in Norma's registry. */
  code: ToolCode;
  /** Side in pixels (default 26, the brand square). */
  size?: number;
  /** Accessible name; without it the logo is decorative (aria-hidden). */
  title?: string;
}

export function ToolLogo({ code, size = 26, title }: ToolLogoProps) {
  const id = `tool-logo-${useId().replace(/:/g, '')}`;
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} focusable="false" {...a11y}>
      {GLYPHS[code](id)}
    </svg>
  );
}

const GLYPHS: Record<ToolCode, (id: string) => ReactElement> = {
  arche: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c95a97"/><stop offset="1" stopColor="#8a2d63"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M12 45Q32 1 52 45"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M9 45h46"/><path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M22 45V30.9"/><circle cx="22" cy="28.5" r="3.4" fill="#fff"/><path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M32 45V25.4"/><circle cx="32" cy="23.0" r="3.4" fill="#fff"/><path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M42 45V30.9"/><circle cx="42" cy="28.5" r="3.4" fill="#fff"/>
    </>
  ),
  clavis: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c9a033"/><stop offset="1" stopColor="#86650f"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><circle cx="23" cy="23" r="9" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/><circle cx="23" cy="23" r="2.6" fill="#fff"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M29.5 29.5L50 50M42 42l4.5-4.5M47 47l4-4"/>
    </>
  ),
  codex: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4f7be6"/><stop offset="1" stopColor="#2a46a6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M32 21c-5.5-3.6-12-4-18-2v27c6-2 12.5-1.6 18 2 5.5-3.6 12-4 18-2V19c-6-2-12.5-1.6-18 2z"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M32 21v27"/><path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M19 27h7M19 33h7M38 27h7M38 33h7"/>
    </>
  ),
  crucible: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e06844"/><stop offset="1" stopColor="#a3361e"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M15 23h34"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M19 23l4.5 21.5a4 4 0 0 0 3.9 3.2h9.2a4 4 0 0 0 3.9-3.2L45 23"/><circle cx="29" cy="37" r="2.6" fill="#fff"/><circle cx="36" cy="32" r="2" fill="#fff"/><path fill="#fff" d="M32 8.5l1.7 4.6 4.6 1.7-4.6 1.7L32 21.1l-1.7-4.6-4.6-1.7 4.6-1.7z"/>
    </>
  ),
  cursus: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34b088"/><stop offset="1" stopColor="#1a7759"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M13 49h10v-8h10v-8h10v-9"/><circle cx="48" cy="15.5" r="4.6" fill="#fff"/>
    </>
  ),
  ingenium: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d4485c"/><stop offset="1" stopColor="#8e1f33"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M32 8.5v4"/><circle cx="32" cy="17" r="4.4" fill="#fff"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M29.6 21L18.5 50M34.4 21L45.5 50"/><path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M21.5 38.5Q32 44 42.5 38.5"/><circle cx="18.5" cy="50" r="2" fill="#fff"/>
    </>
  ),
  keystone: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7466cf"/><stop offset="1" stopColor="#3d318f"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M15 50V35a17 17 0 0 1 34 0v15"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M11 50h42"/><path fill="#fff" d="M26 12.5h12l-2.6 10.5h-6.8z"/>
    </>
  ),
  matrix: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6a7a9c"/><stop offset="1" stopColor="#3b4763"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M17 17H47M17 32H47M17 47H47M17 17V47M32 17V47M47 17V47" opacity=".7"/><circle cx="17" cy="17" r="4" fill="#fff"/><circle cx="32" cy="17" r="4" fill="#fff"/><circle cx="47" cy="17" r="4" fill="#fff"/><circle cx="17" cy="32" r="4" fill="#fff"/><circle cx="32" cy="32" r="6" fill="#fff"/><circle cx="47" cy="32" r="4" fill="#fff"/><circle cx="17" cy="47" r="4" fill="#fff"/><circle cx="32" cy="47" r="4" fill="#fff"/><circle cx="47" cy="47" r="4" fill="#fff"/>
    </>
  ),
  modulus: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#78b043"/><stop offset="1" stopColor="#467a1e"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><rect x="13" y="31" width="17" height="17" rx="3.5" fill="#fff"/><rect x="34" y="31" width="17" height="17" rx="3.5" fill="#fff"/><rect x="13" y="12" width="17" height="17" rx="3.5" fill="#fff"/><rect x="36" y="10" width="15" height="15" rx="3.2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3.2"/>
    </>
  ),
  vector: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2fb0d2"/><stop offset="1" stopColor="#17728f"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><circle cx="15" cy="47" r="4" fill="#fff"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M19.5 44.5C27 39 26 30 33 27s10 1.5 15-6"/><path fill="#fff" d="M52.5 13.5l-1.2 12.2-4.3-4.5-5.4-2.3z"/>
    </>
  ),
  vigie: (id) => (
    <>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e89a37"/><stop offset="1" stopColor="#b0611a"/></linearGradient></defs><rect width="64" height="64" rx="14" fill={`url(#${id})`}/><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.3" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5"/><path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="M11 33c5-9 12.5-14 21-14s16 5 21 14c-5 9-12.5 14-21 14s-16-5-21-14z"/><circle cx="32" cy="33" r="6.5" fill="#fff"/><path fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" d="M32 10v4M20 13l2 3.4M44 13l-2 3.4"/>
    </>
  ),
};
