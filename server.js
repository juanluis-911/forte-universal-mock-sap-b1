// Mock de SAP Business One - demo Forte Universal
// Emula un subconjunto del Service Layer de SAP B1: Business Partners, Item Master Data,
// Sales Orders (ORDR/RDR1). Persistencia en archivo db.json (sobrevive restart/refresh).

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { buildInitialDb } = require('./seed');

// DB_PATH permite apuntar la persistencia a un disco montado (Render: /var/data/db.json).
// Sin la variable, comportamiento de siempre: db.json junto al server.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db.json');
const PORT = process.env.PORT || 4010;

let db;

function loadDb() {
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } else {
    db = buildInitialDb();
    saveDb();
  }
  if (!db.rejectedRequests) db.rejectedRequests = [];

  // MULE_URL manda sobre lo que traiga db.json. Sin esto, un reinicio del contenedor en
  // Render (plan free = sin disco) restaura el db.json del repo y con el las URLs viejas,
  // dejando al mock apuntando a una app de CloudHub que ya no existe. Sintoma: el sync
  // sigue funcionando (Mule -> mock) pero los pedidos no salen (mock -> Mule), en silencio.
  const muleUrl = (process.env.MULE_URL || '').replace(/\/$/, '');
  if (muleUrl) {
    db.config.muleUrl = muleUrl;
    db.config.webhookUrl = `${muleUrl}/api/pedido-status`;
    saveDb();
  }
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

loadDb();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth (Bearer simple) ----------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  // El repo es publico, asi que el token del seed queda a la vista. SAP_BEARER_TOKEN
  // permite rotarlo por entorno sin tocar codigo (hay que actualizarlo tambien en Mule).
  const esperado = process.env.SAP_BEARER_TOKEN || db.config.bearerToken;
  if (!token || token !== esperado) {
    return res.status(401).json({ error: { code: -1, message: 'No autorizado. Bearer token invalido.' } });
  }
  next();
}

// ---------- Modo estres (delay + error rate configurables) ----------
function applyStress(req, res, next) {
  const stress = db.config.stress;
  if (!stress.enabled) return next();
  const doError = Math.random() * 100 < stress.errorRate;
  const delay = stress.delayMs || 0;
  setTimeout(() => {
    if (doError) {
      db.rejectedRequests.unshift({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        cardCode: (req.body && req.body.CardCode) || null,
      });
      db.rejectedRequests = db.rejectedRequests.slice(0, 50);
      saveDb();
      return res.status(500).json({
        error: { code: -999, message: 'Error simulado (modo estres SAP B1 Service Layer no disponible)' },
      });
    }
    next();
  }, delay);
}

app.use('/api/business-partners', requireAuth, applyStress);
app.use('/api/items', requireAuth, applyStress);
app.use('/api/sales-orders', requireAuth, applyStress);

// ---------- Registro de sync de Mule ----------
// Mule le pega a /api/business-partners y /api/items cada 60s (los scheduler flows).
// La UI le pega a los MISMOS endpoints para pintar las tablas, asi que hay que distinguir
// quien llamo: el navegador manda un User-Agent con "Mozilla", Mule manda "AHC/2.1".
// Con esto la UI puede mostrar "ultimo sync hace 12s - proximo en ~48s" con datos REALES,
// no estimados, y la espera de la demo deja de ser un hueco muerto.
const SYNC_INTERVAL_MS = 60000;

function esLlamadaDeMule(req) {
  const ua = req.headers['user-agent'] || '';
  return !ua.includes('Mozilla');
}

function registrarSync(coleccion) {
  return (req, res, next) => {
    if (esLlamadaDeMule(req)) {
      if (!db.lastSync) db.lastSync = {};
      db.lastSync[coleccion] = new Date().toISOString();
      saveDb();
    }
    next();
  };
}

app.get('/api/sync-status', requireAuth, (req, res) => {
  const ls = db.lastSync || {};
  const ahora = Date.now();
  const calc = (iso) => {
    if (!iso) return { lastSync: null, haceMs: null, proximoEnMs: null };
    const haceMs = ahora - new Date(iso).getTime();
    return { lastSync: iso, haceMs, proximoEnMs: Math.max(0, SYNC_INTERVAL_MS - haceMs) };
  };
  res.json({
    intervaloMs: SYNC_INTERVAL_MS,
    businessPartners: calc(ls.businessPartners),
    items: calc(ls.items),
  });
});

// ================== Business Partners ==================
app.get('/api/business-partners', registrarSync('businessPartners'), (req, res) => {
  res.json({ value: db.businessPartners });
});

// PATCH: editar un BP desde la UI para ver el cambio viajar a Salesforce en el proximo sync.
// Solo los campos que se reflejan visiblemente del otro lado (Account.Name, etc).
app.patch('/api/business-partners/:cardCode', (req, res) => {
  const bp = db.businessPartners.find((b) => b.CardCode === req.params.cardCode);
  if (!bp) return res.status(404).json({ error: { code: -2028, message: 'CardCode no encontrado' } });

  const { CardName, CreditLimit, Frozen } = req.body;
  if (CardName !== undefined) {
    if (!String(CardName).trim()) {
      return res.status(400).json({ error: { code: -1, message: 'CardName no puede ir vacio' } });
    }
    bp.CardName = String(CardName).trim();
  }
  if (CreditLimit !== undefined) {
    const n = Number(CreditLimit);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: { code: -1, message: 'CreditLimit debe ser un numero >= 0' } });
    }
    bp.CreditLimit = n;
  }
  if (Frozen !== undefined) {
    if (!['Y', 'N'].includes(Frozen)) {
      return res.status(400).json({ error: { code: -1, message: "Frozen debe ser 'Y' o 'N'" } });
    }
    bp.Frozen = Frozen;
  }
  saveDb();
  res.json(bp);
});

app.get('/api/business-partners/:cardCode', (req, res) => {
  const bp = db.businessPartners.find((b) => b.CardCode === req.params.cardCode);
  if (!bp) return res.status(404).json({ error: { code: -2028, message: 'CardCode no encontrado' } });
  res.json(bp);
});

// ================== Item Master Data ==================
app.get('/api/items', registrarSync('items'), (req, res) => {
  res.json({ value: db.items });
});

// PATCH: editar precio / existencia. El precio es la mejor escena de la demo porque
// viaja hasta el PricebookEntry.UnitPrice de Salesforce (items-sync-flow).
app.patch('/api/items/:itemCode', (req, res) => {
  const item = db.items.find((i) => i.ItemCode === req.params.itemCode);
  if (!item) return res.status(404).json({ error: { code: -2028, message: 'ItemCode no encontrado' } });

  const { Price, OnHand, ItemName } = req.body;
  if (ItemName !== undefined) {
    if (!String(ItemName).trim()) {
      return res.status(400).json({ error: { code: -1, message: 'ItemName no puede ir vacio' } });
    }
    item.ItemName = String(ItemName).trim();
  }
  if (Price !== undefined) {
    const n = Number(Price);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: { code: -1, message: 'Price debe ser un numero > 0' } });
    }
    item.ItemPrices[0].Price = n;
  }
  if (OnHand !== undefined) {
    const n = Number(OnHand);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: { code: -1, message: 'OnHand debe ser un numero >= 0' } });
    }
    item.OnHand = n;
  }
  saveDb();
  res.json(item);
});

app.get('/api/items/:itemCode', (req, res) => {
  const item = db.items.find((i) => i.ItemCode === req.params.itemCode);
  if (!item) return res.status(404).json({ error: { code: -2028, message: 'ItemCode no encontrado' } });
  res.json(item);
});

// ================== Sales Orders ==================
// POST: Mule llama aqui cuando Salesforce confirma un pedido (pedido-queue-consumer-flow)
app.post('/api/sales-orders', (req, res) => {
  const { CardCode, DocumentLines, salesforceOrderId } = req.body;

  const bp = db.businessPartners.find((b) => b.CardCode === CardCode);
  if (!bp) {
    return res.status(400).json({ error: { code: -2028, message: `CardCode ${CardCode} no existe en Business Partners` } });
  }
  if (bp.Frozen === 'Y') {
    return res.status(409).json({ error: { code: -5002, message: `Business Partner ${CardCode} tiene credito congelado (Frozen=Y)` } });
  }
  if (!Array.isArray(DocumentLines) || DocumentLines.length === 0) {
    return res.status(400).json({ error: { code: -1, message: 'DocumentLines vacio' } });
  }

  for (const line of DocumentLines) {
    if (!db.items.find((i) => i.ItemCode === line.ItemCode)) {
      return res.status(400).json({ error: { code: -2028, message: `ItemCode ${line.ItemCode} no encontrado` } });
    }
  }

  let docTotal = 0;
  const lines = DocumentLines.map((line, idx) => {
    const item = db.items.find((i) => i.ItemCode === line.ItemCode);
    const price = item.ItemPrices[0].Price;
    const lineTotal = price * line.Quantity;
    docTotal += lineTotal;
    return {
      LineNum: idx,
      ItemCode: item.ItemCode,
      ItemDescription: item.ItemName,
      Quantity: line.Quantity,
      Price: price,
      LineTotal: lineTotal,
    };
  });

  const docEntry = db.nextDocEntry++;
  const order = {
    DocEntry: docEntry,
    DocNum: 90000 + docEntry,
    CardCode,
    CardName: bp.CardName,
    DocDate: new Date().toISOString().slice(0, 10),
    DocDueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    DocTotal: Math.round(docTotal * 100) / 100,
    DocCurrency: 'MXN',
    DocumentStatus: 'bost_Open',
    DocumentLines: lines,
    SalesPersonCode: bp.SalesPersonCode,
    U_EstatusPedido: 'Pendiente',
    U_Guia: '',
    U_Paqueteria: '',
    U_UrlRastreo: '',
    U_MotivoCancelacion: '',
    U_SalesforceOrderId: salesforceOrderId || '',
    CreatedAt: new Date().toISOString(),
  };

  db.salesOrders.push(order);
  saveDb();
  res.status(201).json(order);
});

app.get('/api/sales-orders', requireAuth, (req, res) => {
  res.json({ value: db.salesOrders });
});

// DELETE: borra pedidos a partir de un DocEntry. Sirve para dejar limpio el mock despues
// de una prueba de carga (que si crea Orders reales en Salesforce, uno por pedido).
// Ojo: esto NO borra los Orders del lado de Salesforce, eso se hace con scripts/clean-orders.
app.delete('/api/sales-orders', requireAuth, (req, res) => {
  const desde = Number(req.query.desdeDocEntry);
  if (!Number.isFinite(desde)) {
    return res.status(400).json({ error: { code: -1, message: 'Falta ?desdeDocEntry=<n>' } });
  }
  const antes = db.salesOrders.length;
  db.salesOrders = db.salesOrders.filter((o) => o.DocEntry < desde);
  saveDb();
  res.json({ borrados: antes - db.salesOrders.length, restantes: db.salesOrders.length });
});

// PATCH: cambia status del pedido (se usa desde la UI SAP B1) -> dispara webhook hacia Mule
app.patch('/api/sales-orders/:docEntry/status', requireAuth, async (req, res) => {
  const docEntry = Number(req.params.docEntry);
  const order = db.salesOrders.find((o) => o.DocEntry === docEntry);
  if (!order) return res.status(404).json({ error: { code: -2028, message: 'DocEntry no encontrado' } });

  const { estatus, guia, paqueteria, urlRastreo, motivoCancelacion } = req.body;
  const validos = ['Pendiente', 'Recoleccion', 'Enviado', 'Entregado', 'Cancelado'];
  if (!validos.includes(estatus)) {
    return res.status(400).json({ error: { code: -1, message: `Estatus invalido. Validos: ${validos.join(', ')}` } });
  }

  order.U_EstatusPedido = estatus;
  if (guia !== undefined) order.U_Guia = guia;
  if (paqueteria !== undefined) order.U_Paqueteria = paqueteria;
  if (urlRastreo !== undefined) order.U_UrlRastreo = urlRastreo;
  if (motivoCancelacion !== undefined) order.U_MotivoCancelacion = motivoCancelacion;
  if (estatus === 'Cancelado') order.DocumentStatus = 'bost_Close';
  saveDb();

  await sendStatusWebhook(order);
  res.json(order);
});

async function sendStatusWebhook(order) {
  const url = db.config.webhookUrl;
  if (!url) return;
  const payload = {
    DocEntry: order.DocEntry,
    U_SalesforceOrderId: order.U_SalesforceOrderId,
    U_EstatusPedido: order.U_EstatusPedido,
    U_Guia: order.U_Guia,
    U_Paqueteria: order.U_Paqueteria,
    U_UrlRastreo: order.U_UrlRastreo,
    U_MotivoCancelacion: order.U_MotivoCancelacion,
  };
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[webhook] error enviando status a Mule:', err.message);
  }
}

// ================== Configuracion en caliente ==================
app.get('/api/config/webhook', requireAuth, (req, res) => res.json({ webhookUrl: db.config.webhookUrl }));
app.post('/api/config/webhook', requireAuth, (req, res) => {
  db.config.webhookUrl = req.body.webhookUrl || '';
  saveDb();
  res.json({ webhookUrl: db.config.webhookUrl });
});

app.get('/api/config/mule', requireAuth, (req, res) => res.json({ muleUrl: db.config.muleUrl }));
app.post('/api/config/mule', requireAuth, (req, res) => {
  db.config.muleUrl = req.body.muleUrl || '';
  saveDb();
  res.json({ muleUrl: db.config.muleUrl });
});

app.get('/api/config/stress', requireAuth, (req, res) => res.json(db.config.stress));
app.post('/api/config/stress', requireAuth, (req, res) => {
  const { enabled, delayMs, errorRate } = req.body;
  if (enabled !== undefined) db.config.stress.enabled = !!enabled;
  if (delayMs !== undefined) db.config.stress.delayMs = Number(delayMs);
  if (errorRate !== undefined) db.config.stress.errorRate = Number(errorRate);
  saveDb();
  res.json(db.config.stress);
});

// Llamadas que el modo estres rechazo con 500 - para que la UI muestre que si paso algo.
app.get('/api/rejected-requests', requireAuth, (req, res) => res.json({ value: db.rejectedRequests }));
app.delete('/api/rejected-requests', requireAuth, (req, res) => {
  db.rejectedRequests = [];
  saveDb();
  res.json({ value: db.rejectedRequests });
});

// ================== Simulacion "Salesforce" (UI tab) ==================
// La UI llama esto para simular que Salesforce confirmo un pedido: dispara el
// pedido-outbound-flow de Mule (HTTP listener), con BP + 1-3 items aleatorios.
app.post('/api/simulate/salesforce-order', requireAuth, async (req, res) => {
  const muleUrl = db.config.muleUrl;
  if (!muleUrl) return res.status(400).json({ error: { code: -1, message: 'Configura primero la URL de Mule (config/mule)' } });

  const { CardCode, DocumentLines } = req.body.CardCode ? req.body : buildRandomOrderPayload();

  try {
    const resp = await fetch(`${muleUrl.replace(/\/$/, '')}/api/pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Bug #17, segunda parte: NO mandar salesforceOrderId. Esta pestana simula que
      // Salesforce confirma un pedido, pero no hay ningun Order real detras. Si mandamos
      // un Id inventado (`SF-<timestamp>`), pedido-queue-consumer-flow lo toma como
      // "el Order ya existe" y hace salesforce:update contra un Id que no es un Id de
      // Salesforce -> MALFORMED_ID, el pedido llega a SAP pero nunca aparece en SF.
      // Sin el campo, el flow toma la rama de create y si crea el Order. Mismo criterio
      // que /api/loadtest, que ya manda el payload limpio.
      body: JSON.stringify({
        CardCode,
        DocumentLines,
      }),
    });
    const body = await resp.json().catch(() => ({}));
    res.status(resp.status).json(body);
  } catch (err) {
    res.status(502).json({ error: { code: -1, message: `No se pudo contactar Mule: ${err.message}` } });
  }
});

// ================== Load test ==================
function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function buildRandomOrderPayload() {
  const bpsActivos = db.businessPartners.filter((b) => b.Frozen === 'N');
  const bp = bpsActivos[randomInt(0, bpsActivos.length - 1)];
  const numItems = randomInt(1, 3);
  const itemsElegidos = new Set();
  while (itemsElegidos.size < numItems) {
    itemsElegidos.add(db.items[randomInt(0, db.items.length - 1)].ItemCode);
  }
  const DocumentLines = [...itemsElegidos].map((ItemCode) => ({
    ItemCode,
    Quantity: randomInt(4, 120),
  }));
  return { CardCode: bp.CardCode, DocumentLines };
}

app.post('/api/loadtest', requireAuth, async (req, res) => {
  const { count = 10, targetUrl } = req.body;
  const url = (targetUrl || db.config.muleUrl || '').replace(/\/$/, '');
  if (!url) return res.status(400).json({ error: { code: -1, message: 'Sin targetUrl ni muleUrl configurada' } });

  const resultados = [];
  for (let i = 0; i < count; i++) {
    const payload = buildRandomOrderPayload();
    const started = Date.now();
    try {
      const resp = await fetch(`${url}/api/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      resultados.push({ ok: resp.ok, status: resp.status, ms: Date.now() - started, CardCode: payload.CardCode, items: payload.DocumentLines.length });
    } catch (err) {
      resultados.push({ ok: false, status: 0, ms: Date.now() - started, error: err.message });
    }
  }
  res.json({ total: count, exitosos: resultados.filter((r) => r.ok).length, fallidos: resultados.filter((r) => !r.ok).length, resultados });
});

// En Vercel no se abre puerto: la plataforma invoca la app como handler serverless.
// En local y en Render (proceso normal) se levanta el listener de siempre.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Mock SAP Business One (Forte Universal) escuchando en http://localhost:${PORT}`);
    console.log(`Bearer token demo: ${db.config.bearerToken}`);
  });
}

module.exports = app;
