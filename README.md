# Mock SAP Business One — Demo Forte Universal

Emula un subconjunto del Service Layer de SAP B1 (Business Partners, Item Master Data,
Sales Orders ORDR/RDR1) para la demo **Salesforce &lt;-&gt; MuleSoft &lt;-&gt; SAP B1**.

Incluye una consola web en `/` (servida desde `public/`) para operar la demo: cambiar estado
de pedidos, configurar el webhook a Mule, activar modo estrés y lanzar pruebas de carga.

## Local

```bash
npm install
npm start          # http://localhost:4010
npm run seed       # regenera db.json desde cero
```

## Deploy en Render

El repo trae `render.yaml` (Blueprint). En Render: **New → Blueprint** → apuntar a este repo.
Crea un web service plan `starter` en región `ohio` con un disco de 1 GB montado en `/var/data`.

Variables de entorno relevantes:

| Variable   | Default            | Para qué |
|------------|--------------------|----------|
| `PORT`     | `4010`             | Lo inyecta Render automáticamente |
| `DB_PATH`  | `./db.json`        | Ruta de persistencia. En Render apunta al disco: `/var/data/db.json` |

Con `DB_PATH` en el disco, el primer arranque siembra estado limpio (40 Business Partners,
24 items, 0 pedidos) y a partir de ahí sobrevive redeploys y reinicios.

## Endpoints principales

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET   | `/api/business-partners`            | no  | Listado (lo consume `business-partners-sync-flow`) |
| PATCH | `/api/business-partners/:cardCode`  | no  | Modifica un BP |
| GET   | `/api/items`                        | no  | Listado (lo consume `items-sync-flow`) |
| PATCH | `/api/items/:itemCode`              | no  | Modifica un item |
| POST  | `/api/sales-orders`                 | no  | Alta de pedido (lo llama `pedido-outbound-flow`) |
| GET   | `/api/sales-orders`                 | sí  | Listado de pedidos |
| PATCH | `/api/sales-orders/:docEntry/status`| sí  | Cambia estado y dispara el webhook a Mule |
| GET   | `/api/sync-status`                  | sí  | Último sync real detectado por User-Agent de Mule |
| GET/POST | `/api/config/webhook`            | sí  | URL del webhook `pedido-status-inbound-flow` |
| GET/POST | `/api/config/mule`               | sí  | Base URL de Mule |
| GET/POST | `/api/config/stress`             | sí  | Delay y tasa de error inyectados |
| POST  | `/api/simulate/salesforce-order`    | sí  | Genera un pedido de prueba contra Mule |
| POST  | `/api/loadtest`                     | sí  | Prueba de carga |

Auth = `Authorization: Bearer <db.config.bearerToken>`.

## Tras desplegar

1. Copiar la URL pública de Render.
2. Actualizar la propiedad `sap.host` en CloudHub y redesplegar.
3. En la consola del mock, poner el webhook apuntando a
   `https://<app-cloudhub>/api/pedido-status`.
