const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack');
const WextManifestWebpackPlugin = require('wext-manifest-webpack-plugin');

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';
const sourceDir = path.resolve(__dirname, '..', 'src');
const distDir = path.resolve(__dirname, '..', 'dist', targetBrowser);

module.exports = {
  entry: {
    background: path.join(sourceDir, 'background', 'index.ts'),
    'content-scripts/inject-scripts': path.join(sourceDir, 'content-scripts', 'inject-scripts.ts'),
    'content-scripts/window-ethereum-messages': path.join(
      sourceDir,
      'content-scripts',
      'window-ethereum-messages.ts',
    ),
    'content-scripts/bypass-check': path.join(sourceDir, 'content-scripts', 'bypass-check.ts'),
    'injected/proxy-injected-providers': path.join(
      sourceDir,
      'injected',
      'proxy-injected-providers.ts',
    ),
    manifest: path.join(sourceDir, 'manifest.json'),
  },
  output: {
    filename: 'js/[name].js',
    path: distDir,
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias: {
      '@lib': path.resolve(sourceDir, 'lib'),
    },
  },
  module: {
    rules: [
      {
        type: 'javascript/auto',
        test: /manifest\.json$/,
        use: {
          loader: 'wext-manifest-loader',
          options: { usePackageJSONVersion: true },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new WextManifestWebpackPlugin(),
    new Dotenv({ path: path.resolve(__dirname, '..', '.env'), safe: false, silent: true }),
    new CopyPlugin({
      patterns: [{ from: path.resolve(__dirname, '..', 'public'), to: distDir }],
    }),
  ],
};
