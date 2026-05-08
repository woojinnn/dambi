const path = require('path');
const webpack = require('webpack');
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
    'confirm/index': path.join(sourceDir, 'confirm', 'index.ts'),
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
      '@background': path.resolve(sourceDir, 'background'),
    },
    fallback: {
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser'),
    },
  },
  experiments: {
    asyncWebAssembly: true,
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
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new WextManifestWebpackPlugin(),
    new Dotenv({ path: path.resolve(__dirname, '..', '.env'), safe: false, silent: true }),
    // ProvidePlugin for `process` so readable-stream's `process.nextTick` etc.
    // resolve at runtime even in code paths that don't import it explicitly.
    new webpack.ProvidePlugin({ process: 'process/browser' }),
    new CopyPlugin({
      patterns: [{ from: path.resolve(__dirname, '..', 'public'), to: distDir }],
    }),
  ],
};
