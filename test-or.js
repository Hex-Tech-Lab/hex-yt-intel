const http = require('https');

const data = JSON.stringify({
  model: 'anthropic/claude-haiku-4.5',
  max_tokens: 16000,
  stream: true,
  messages: [{ role: 'user', content: 'Hello' }]
});

const req = http.request('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  console.log('Status:', res.statusCode);
  res.on('data', (d) => process.stdout.write(d));
});

req.on('error', console.error);
req.write(data);
req.end();
