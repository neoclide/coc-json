const path = require('path')

module.exports = {
  entry: './lib/server/jsonServerMain',
  target: 'node',
  mode: 'none',
  output: {
    path: path.resolve(__dirname, '.release/lib/server'),
    filename: 'jsonServerMain.js'
  },
  plugins: [
  ],
  node: {
    __filename: false,
    __dirname: false
  }
}
