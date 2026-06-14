import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';

const dev = !!process.env.ROLLUP_WATCH;

export default {
  input: 'src/tesla-card.ts',
  output: {
    file: 'dist/tesla-card.js',
    format: 'es',
    inlineDynamicImports: true,
    sourcemap: dev,
  },
  plugins: [
    resolve(),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json' }),
    !dev &&
      terser({
        format: { comments: false },
        compress: { passes: 2 },
      }),
  ],
  // HA frontend provides these as globals at runtime; never bundle them.
  // (We don't import them, but guard anyway.)
  onwarn(warning, warn) {
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    warn(warning);
  },
};
