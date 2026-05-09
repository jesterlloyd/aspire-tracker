// api/keith.js - minimal diagnostic version
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'Keith is alive', hasApiKey: !!process.env.ANTHROPIC_API_KEY });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({ response: 'Keith diagnostic: POST received successfully.' });
};
