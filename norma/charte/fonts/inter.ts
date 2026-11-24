import localFont from 'next/font/local';

/**
 * Inter, served from the repository so that `next build` needs no network (point 42 of docs/reste-a-faire.md).
 * The seven files are the ones next/font/google downloaded for `Inter({ subsets: ['latin'] })` until 17 October 2026,
 * byte for byte: Inter 4.001, variable weight axis (100–900), cut by Google Fonts (v20) into the seven subsets below,
 * each with Google's unicode-range. Same faces, same family name (Inter), same variable (--font-inter), only the latin
 * subset preloaded: the rendering does not change. Licence: SIL Open Font License 1.1, ./inter/OFL.txt.
 *
 * next/font/local writes one @font-face per call and takes no unicode-range per file: one call per subset, each naming
 * the family itself (declarations). Only the latin call is used (its variable, on <html>): importing this module is
 * enough for the bundler to keep the other calls' faces with the page's CSS. Turbopack names the family of the variable
 * after the constant (`inter`), which CSS matches with the faces' `Inter` regardless of case: keep the name.
 * Each call must be written out in full: next/font reads its arguments at build time, as literals.
 *
 * The fallback is the size-adjusted Arial next/font/google declared ('Inter Fallback', its values in src/app/globals.css)
 * rather than the one next/font/local would compute from the latin file (slightly different metrics). It draws the
 * characters no subset covers (arrows such as →, for instance), as before.
 */
export const inter = localFont({
  src: './inter/inter-latin-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', variable: '--font-inter',
  adjustFontFallback: false, fallback: ['Inter Fallback'],
  declarations: [{ prop: 'font-family', value: 'Inter' }, { prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
});
const latinExt = localFont({
  src: './inter/inter-latin-ext-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', preload: false, adjustFontFallback: false,
  declarations: [{ prop: 'font-family', value: 'Inter' }, { prop: 'unicode-range', value: 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF' }],
});
const cyrillicExt = localFont({
  src: './inter/inter-cyrillic-ext-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', preload: false, adjustFontFallback: false,
  declarations: [{ prop: 'font-family', value: 'Inter' }, { prop: 'unicode-range', value: 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F' }],
});
const cyrillic = localFont({
  src: './inter/inter-cyrillic-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', preload: false, adjustFontFallback: false,
  declarations: [{ prop: 'font-family', value: 'Inter' }, { prop: 'unicode-range', value: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' }],
});
const greekExt = localFont({
  src: './inter/inter-greek-ext-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', preload: false, adjustFontFallback: false,
  declarations: [{ prop: 'font-family', value: 'Inter' }, { prop: 'unicode-range', value: 'U+1F00-1FFF' }],
});
const greek = localFont({
  src: './inter/inter-greek-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', preload: false, adjustFontFallback: false,
  declarations: [{ prop: 'font-family', value: 'Inter' }, { prop: 'unicode-range', value: 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF' }],
});
const vietnamese = localFont({
  src: './inter/inter-vietnamese-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', preload: false, adjustFontFallback: false,
  declarations: [{ prop: 'font-family', value: 'Inter' }, { prop: 'unicode-range', value: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB' }],
});

/** Class for <html>: sets --font-inter, which Nocturne's --font-body and --font-heading start with. */
export const interClassName = inter.variable;

/** The other subsets, read by nothing: their faces come with the module's CSS. Exported so that lint does not drop them. */
export const interSubsets = [latinExt, cyrillicExt, cyrillic, greekExt, greek, vietnamese];
