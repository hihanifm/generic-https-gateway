const http = require('http');

const port = Number(process.env.PORT || 33101);
const appName = process.env.APP_NAME || 'app1';

const server = http.createServer((req, res) => {
  const now = new Date().toISOString();

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', app: appName, time: now }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      app: appName,
      message: 'Hello from app1',
      path: req.url,
      method: req.method,
      time: now
    })
  );
});

server.listen(port, '0.0.0.0', () => {
  console.log(`${appName} listening on ${port}`);
});
