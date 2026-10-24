// Netlify's contract: 0 skips a Git build; 1 continues it.
// Build hooks bypass ignore, so manual production releases remain available.
process.exitCode = process.env.CONTEXT === 'production' ? 0 : 1;
