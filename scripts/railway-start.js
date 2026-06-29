const mode = (process.env.APP_MODE || 'bot').toLowerCase();

if (mode === 'insights') {
  require('../insights-server.js');
} else {
  require('../index.js');
}
