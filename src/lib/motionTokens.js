// MOTION-1: the numbers Motion animates with. They mirror the --aspire-dur-* and
// --aspire-ease-* tokens in src/styles/aspireBrand.css (a test holds the two equal),
// because Motion takes seconds and arrays, not CSS variables.
export const DUR = { fast: 0.12, base: 0.18, slow: 0.26 }
export const EASE_OUT = [0.2, 0.7, 0.2, 1]
export const EASE_IN = [0.4, 0, 1, 1]

// A surface arriving and leaving. Leaving is quicker than arriving.
export const enter = { duration: DUR.slow, ease: EASE_OUT }
export const exit = { duration: DUR.base, ease: EASE_IN }
