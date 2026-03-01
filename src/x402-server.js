import express from 'express';
import { paymentMiddleware } from 'x402-express';

const app = express();
app.set('trust proxy', true);
app.use(express.json());

const PAY_TO = process.env.PAY_TO || '0x62Ab5ce642772eD44317A11B879ab568b250374C';
const PORT = Number(process.env.X402_PORT || 8790);
const CORE_URL = process.env.CORE_URL || 'http://localhost:8787';
const CORE_API_KEY = process.env.CORE_API_KEY || process.env.USER_API_KEY;

if (!CORE_API_KEY) {
  console.error('Missing CORE_API_KEY/USER_API_KEY for TripWire core auth');
  process.exit(1);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'TripWire-x402', payTo: PAY_TO, coreUrl: CORE_URL });
});

app.get('/debug/core', async (_req, res) => {
  try {
    const health = await fetch(`${CORE_URL}/health`);
    const watches = await fetch(`${CORE_URL}/v1/watches`, {
      headers: { 'x-api-key': CORE_API_KEY }
    });
    const watchesText = await watches.text();
    res.json({
      coreUrl: CORE_URL,
      healthStatus: health.status,
      watchesStatus: watches.status,
      watchesPreview: watchesText.slice(0, 200)
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const payment = paymentMiddleware(PAY_TO, {
  'POST /x402/v1/watches': {
    price: '$0.02',
    network: 'base',
    config: {
      description: 'Create a TripWire watch (http_status, page_change, json_threshold).',
      inputSchema: {
        bodyType: 'json',
        bodyFields: {
          type: { type: 'string', required: true, description: 'http_status | page_change | json_threshold' },
          targetUrl: { type: 'string', required: true, description: 'URL to monitor' },
          webhookUrl: { type: 'string', required: true, description: 'Webhook destination URL' },
          maxLatencyMs: { type: 'number', required: false, description: 'Optional latency threshold' },
          field: { type: 'string', required: false, description: 'JSON field for json_threshold' },
          operator: { type: 'string', required: false, description: 'gt|lt|eq' },
          threshold: { type: 'number', required: false, description: 'Threshold value' }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          watch: { type: 'object' }
        }
      }
    }
  },
  'GET /x402/v1/watches': {
    price: '$0.005',
    network: 'base',
    config: {
      description: 'List TripWire watches',
      outputSchema: { type: 'object' }
    }
  },
  'GET /x402/v1/watches/:id/events': {
    price: '$0.005',
    network: 'base',
    config: {
      description: 'Get recent TripWire events for a watch',
      outputSchema: { type: 'object' }
    }
  },
  'PATCH /x402/v1/watches/:id': {
    price: '$0.005',
    network: 'base',
    config: {
      description: 'Pause/resume a watch',
      inputSchema: {
        bodyType: 'json',
        bodyFields: {
          active: { type: 'boolean', required: true, description: 'true to resume, false to pause' }
        }
      },
      outputSchema: { type: 'object' }
    }
  }
});

async function proxy(req, res, path, method = req.method) {
  const upstream = await fetch(`${CORE_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': CORE_API_KEY
    },
    body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(req.body || {})
  });

  const text = await upstream.text();
  res.status(upstream.status);
  res.set('content-type', upstream.headers.get('content-type') || 'application/json');
  res.send(text);
}

app.post('/x402/v1/watches', payment, async (req, res) => {
  await proxy(req, res, '/v1/watches', 'POST');
});

app.get('/x402/v1/watches', payment, async (req, res) => {
  await proxy(req, res, '/v1/watches', 'GET');
});

app.get('/x402/v1/watches/:id/events', payment, async (req, res) => {
  await proxy(req, res, `/v1/watches/${req.params.id}/events`, 'GET');
});

app.patch('/x402/v1/watches/:id', payment, async (req, res) => {
  await proxy(req, res, `/v1/watches/${req.params.id}`, 'PATCH');
});

app.listen(PORT, () => {
  console.log(`TripWire x402 running on http://localhost:${PORT}`);
});
