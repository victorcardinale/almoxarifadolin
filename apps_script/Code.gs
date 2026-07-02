/**
 * Google Apps Script — Pedidos Almoxarifado LIN
 * Instituto Butantan
 *
 * INSTRUÇÕES:
 * 1. Abra a planilha: https://docs.google.com/spreadsheets/d/1c1ZNN7RVtGxvNd4khXZaVp88CvWOg-Nia-3g55UqMRo
 * 2. Vá em Extensões > Apps Script
 * 3. Apague o código existente e cole este arquivo inteiro
 * 4. Clique em "Implantar" > "Nova implantação"
 * 5. Tipo: "App da Web"
 * 6. Executar como: "Eu" (sua conta)
 * 7. Quem tem acesso: "Qualquer pessoa"
 * 8. Clique em "Implantar" e copie a URL gerada
 * 9. Cole a URL no arquivo script.js (variável APPS_SCRIPT_URL)
 */

const SPREADSHEET_ID = '1c1ZNN7RVtGxvNd4khXZaVp88CvWOg-Nia-3g55UqMRo';
const ORDERS_SHEET_NAME = 'PEDIDOS';

// Nomes possíveis para a aba de materiais (varia conforme idioma do Google Sheets)
const MATERIALS_SHEET_NAMES = ['Sheet1', 'Planilha1', 'Página1', 'Folha1'];

// ==================== REQUEST HANDLERS ====================

function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    switch (action) {
      case 'materials':
        result = getMaterials();
        break;
      case 'next_id':
        result = getNextId();
        break;
      case 'submit':
        const data = JSON.parse(e.parameter.data);
        result = submitOrder(data);
        break;
      default:
        result = { error: 'Ação inválida' };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const result = submitOrder(data);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Busca a aba de materiais tentando vários nomes.
 * Se nenhum nome bater, usa a primeira aba da planilha.
 */
function findMaterialsSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = null;

  for (var n = 0; n < MATERIALS_SHEET_NAMES.length; n++) {
    sheet = ss.getSheetByName(MATERIALS_SHEET_NAMES[n]);
    if (sheet) return sheet;
  }

  // Fallback: usa a primeira aba (índice 0)
  var sheets = ss.getSheets();
  if (sheets.length > 0) return sheets[0];

  throw new Error('Nenhuma aba de materiais encontrada na planilha.');
}

// ==================== DATA FUNCTIONS ====================

/**
 * Retorna a lista de materiais.
 * Coluna A = Código SAP, Coluna B = Descrição
 */
function getMaterials() {
  var sheet = findMaterialsSheet();
  var data = sheet.getDataRange().getValues();

  var materials = [];
  var seen = {};

  for (var i = 1; i < data.length; i++) {
    var sap = String(data[i][0]).trim();
    var descricao = String(data[i][1]).trim();

    if (!sap || !descricao) continue;

    // Remove duplicatas
    var key = sap + '|' + descricao;
    if (seen[key]) continue;
    seen[key] = true;

    materials.push({ sap: sap, descricao: descricao });
  }

  return { materials: materials };
}

/**
 * Retorna o próximo ID sequencial baseado na aba PEDIDOS
 */
function getNextId() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return { nextId: 1 };
  }

  // Busca todos os IDs existentes e encontra o maior
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let maxId = 0;

  ids.forEach(function (row) {
    const id = parseInt(row[0]);
    if (!isNaN(id) && id > maxId) {
      maxId = id;
    }
  });

  return { nextId: maxId + 1 };
}

/**
 * Envia um pedido para a aba PEDIDOS
 * Colunas: ID_Pedido | Data Retirada | Período | Horário Pedido | Email |
 *          Desc1 | SAP1 | Qty1 | Desc2 | SAP2 | Qty2 | ... até 5
 */
function submitOrder(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

  // Gera timestamp atual no fuso de Brasília
  const now = Utilities.formatDate(
    new Date(),
    'America/Sao_Paulo',
    'dd/MM/yyyy HH:mm:ss'
  );

  const row = [
    data.idPedido,
    data.dataRetirada || '',
    data.periodo || '',
    now,
    data.email || ''
  ];

  // Adiciona os 5 materiais (descrição, SAP, quantidade)
  for (let i = 1; i <= 5; i++) {
    row.push(data['desc' + i] || '');
    row.push(data['sap' + i] || '');
    row.push(data['qty' + i] || '');
  }

  sheet.appendRow(row);

  // Atualiza headers se necessário (apenas na primeira execução)
  ensureHeaders(sheet);

  return { success: true, idPedido: data.idPedido };
}

/**
 * Garante que os headers da aba PEDIDOS estejam corretos
 */
function ensureHeaders(sheet) {
  const firstCell = sheet.getRange(1, 1).getValue();
  if (firstCell === 'ID_Pedido') return; // Headers já existem

  const headers = [
    'ID_Pedido', 'Data Retirada', 'Período', 'Horário Pedido', 'Email',
    'Descrição material 1', 'Código SAP 1', 'Quantidade 1',
    'Descrição material 2', 'Código SAP 2', 'Quantidade 2',
    'Descrição material 3', 'Código SAP 3', 'Quantidade 3',
    'Descrição material 4', 'Código SAP 4', 'Quantidade 4',
    'Descrição material 5', 'Código SAP 5', 'Quantidade 5'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

/**
 * Função auxiliar para configurar headers manualmente
 * Execute esta função uma vez pelo editor do Apps Script
 */
function setupHeaders() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  ensureHeaders(sheet);
  Logger.log('Headers configurados com sucesso!');
}
