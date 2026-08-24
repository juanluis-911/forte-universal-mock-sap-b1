// Generacion de datos semilla: catalogo de llantas + Business Partners
// Vocabulario SAP Business One: CardCode/CardName (BP), ItemCode/ItemName (Item Master Data)

const SEGMENTOS = ['PCR', 'TBR', 'AGRICOLA', 'ATV', 'INDUSTRIAL', 'GOLF'];
const MARCAS = ['Ovation', 'Prinx', 'Fortire', 'BlackArrow'];

const GRUPO_ITEM = {
  PCR: 100,
  TBR: 110,
  AGRICOLA: 120,
  ATV: 130,
  INDUSTRIAL: 140,
  GOLF: 150,
};

// Catalogo base: [segmento, medida, patronNombre]
const CATALOGO_BASE = [
  ['PCR', '195/65R15', 'EcoVision'],
  ['PCR', '205/55R16', 'RoadMaster VP'],
  ['PCR', '215/60R16', 'TouringPro'],
  ['PCR', '225/45R17', 'SportGrip'],
  ['PCR', '235/55R18', 'SUV Terrain X'],
  ['PCR', '175/70R14', 'CityRunner'],
  ['TBR', '295/80R22.5', 'RoadLux TR688'],
  ['TBR', '11R22.5', 'HaulMax HD'],
  ['TBR', '275/80R22.5', 'CargoMile'],
  ['TBR', '315/80R22.5', 'TransAxle Pro'],
  ['TBR', '10R22.5', 'UrbanBus CityLine'],
  ['AGRICOLA', '18.4-30', 'AgriPower R1'],
  ['AGRICOLA', '14.9-24', 'FieldMaster R1'],
  ['AGRICOLA', '23.1-30', 'HarvestGrip R1W'],
  ['AGRICOLA', '13.6-28', 'TracFarm R1'],
  ['ATV', '25x8-12', 'DuneRider'],
  ['ATV', '26x9-12', 'TrailBlazer XT'],
  ['ATV', '25x10-12', 'MudCrawler'],
  ['ATV', '22x7-10', 'SportQuad'],
  ['INDUSTRIAL', '6.50-10', 'ForkLift Solid'],
  ['INDUSTRIAL', '28x9-15', 'WareMax Industrial'],
  ['INDUSTRIAL', '7.00-12', 'HeavyDuty Pneumatic'],
  ['GOLF', '18x8.50-8', 'GreenGlide'],
  ['GOLF', '205/50-10', 'CartPro Smooth'],
];

function precioBase(segmento) {
  const rangos = {
    PCR: [850, 2200],
    TBR: [4200, 9800],
    AGRICOLA: [6500, 15800],
    ATV: [1800, 3600],
    INDUSTRIAL: [1200, 3200],
    GOLF: [650, 1400],
  };
  const [min, max] = rangos[segmento];
  return Math.round((min + Math.random() * (max - min)) / 10) * 10;
}

function buildItems() {
  return CATALOGO_BASE.map((row, idx) => {
    const [segmento, medida, patron] = row;
    const marca = MARCAS[idx % MARCAS.length];
    const itemCode = `${marca.slice(0, 3).toUpperCase()}-${segmento}-${String(idx + 1).padStart(3, '0')}`;
    const precioLista1 = precioBase(segmento); // Lista Mayoreo
    const precioLista2 = Math.round(precioLista1 * 1.18); // Lista Distribuidor (menor volumen)
    return {
      ItemCode: itemCode,
      ItemName: `${marca} ${patron} ${medida}`,
      ItemsGroupCode: GRUPO_ITEM[segmento],
      ItmsGrpNam: segmento,
      U_Marca: marca,
      U_Medida: medida,
      Manufacturer: marca,
      OnHand: Math.floor(50 + Math.random() * 450),
      InventoryUOM: 'PZA',
      Valid: 'tYES',
      ItemPrices: [
        { PriceList: 1, PriceListName: 'Lista Mayoreo', Price: precioLista1, Currency: 'MXN' },
        { PriceList: 2, PriceListName: 'Lista Distribuidor', Price: precioLista2, Currency: 'MXN' },
      ],
    };
  });
}

const RAZONES_SOCIALES = [
  'Distribuidora de Llantas', 'Refaccionaria', 'Flotillas', 'Comercializadora de Neumaticos',
  'Grupo Llantero', 'Autopartes y Rodamiento', 'Llantas y Servicios', 'Transportes',
  'Importadora de Llantas', 'Neumaticos del Norte', 'Refacciones Industriales',
  'Distribuidora Agricola', 'Maquinaria y Llantas',
];
const SUFIJOS = [
  'del Bajio', 'del Norte', 'del Pacifico', 'Sureste', 'Centro', 'Industrial',
  'Fronteriza', 'La Union', 'El Camino', 'San Miguel', 'Los Pinos', 'del Valle',
  'Guadalajara', 'Monterrey', 'Puebla', 'Queretaro', 'Leon', 'Merida', 'Toluca', 'Tijuana',
];
const VENDEDORES = [
  { code: 1, name: 'Ricardo Mendoza' },
  { code: 2, name: 'Ana Lucia Torres' },
  { code: 3, name: 'Jorge Villareal' },
  { code: 4, name: 'Paulina Reyes' },
  { code: 5, name: 'Hector Salinas' },
];
const ESTADOS_MX = ['Jalisco', 'Nuevo Leon', 'CDMX', 'Puebla', 'Queretaro', 'Yucatan', 'Estado de Mexico', 'Baja California', 'Guanajuato', 'Sonora'];

function buildBusinessPartners(count = 40) {
  const partners = [];
  for (let i = 1; i <= count; i++) {
    const razon = RAZONES_SOCIALES[i % RAZONES_SOCIALES.length];
    const sufijo = SUFIJOS[(i * 3) % SUFIJOS.length];
    const cardCode = `C${String(10000 + i)}`;
    const vendedor = VENDEDORES[i % VENDEDORES.length];
    const creditLimit = [50000, 100000, 150000, 250000, 400000, 600000][i % 6];
    const balance = Math.round(creditLimit * Math.random() * 0.7);
    const frozen = Math.random() < 0.08 ? 'Y' : 'N'; // ~8% BPs congelados (credito bloqueado)
    partners.push({
      CardCode: cardCode,
      CardName: `${razon} ${sufijo}`,
      CardType: 'cCustomer',
      GroupCode: 100,
      Currency: 'MXN',
      CreditLimit: creditLimit,
      Balance: balance,
      Frozen: frozen,
      SalesPersonCode: vendedor.code,
      SalesPersonName: vendedor.name,
      Phone1: `55${Math.floor(10000000 + Math.random() * 89999999)}`,
      City: ESTADOS_MX[i % ESTADOS_MX.length],
      State: ESTADOS_MX[i % ESTADOS_MX.length],
      Country: 'MX',
    });
  }
  return partners;
}

function buildInitialDb() {
  return {
    businessPartners: buildBusinessPartners(40),
    items: buildItems(),
    salesOrders: [],
    nextDocEntry: 1,
    config: {
      webhookUrl: '',
      muleUrl: '',
      bearerToken: 'forte-sap-b1-demo-token',
      stress: {
        enabled: false,
        delayMs: 0,
        errorRate: 0,
      },
    },
  };
}

module.exports = { buildInitialDb };
