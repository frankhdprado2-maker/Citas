import ExcelJS from 'exceljs';
import { mkdir, access, rename, copyFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const columns = [
  ['id', 'Identificador', 38], ['date', 'Fecha', 16], ['time', 'Hora', 12],
  ['plan', 'Plan', 24], ['food', 'Comida', 24], ['location', 'Lugar', 32],
  ['note', 'Comentario', 55], ['status', 'Estado', 18], ['createdAt', 'Registro (UTC)', 26],
  ['updatedAt', 'Actualización (UTC)', 26], ['timezone', 'Zona horaria', 24],
  ['tokenHash', 'Control de acceso', 68], ['requestId', 'Control de envío', 38],
  ['guestEmail', 'Correo invitada', 35], ['emailEvent', 'Control de aviso', 38],
  ['emailStatus', 'Estado del correo', 25]
];
const notificationColumns = [
  ['id', 'Aviso', 38], ['appointmentId', 'Salida', 38], ['eventId', 'Evento', 38],
  ['kind', 'Tipo', 20], ['recipient', 'Destinatario', 35], ['status', 'Estado', 24],
  ['createdAt', 'Registro (UTC)', 26], ['attemptedAt', 'Intento (UTC)', 26],
  ['acceptedAt', 'Aceptado (UTC)', 26], ['messageId', 'Referencia del correo', 45],
  ['error', 'Detalle', 65], ['snapshot', 'Datos del aviso', 80]
];

// Todas las lecturas y escrituras pasan por una única cola. Diseñado para una
// instancia de Node: no ejecutar clústeres ni compartir el Excel entre servicios.
export class ExcelStore {
  constructor(directory) {
    this.directory = directory;
    this.path = join(directory, 'citas.xlsx');
    this.tail = Promise.resolve();
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
    try { await access(this.path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.write([]);
    }
    await this.read(); // Un archivo dañado nunca se sobrescribe silenciosamente.
  }

  run(operation) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result;
  }

  async readState() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.path);
    const sheet = workbook.getWorksheet('Citas');
    if (!sheet) throw new Error('El Excel no contiene la hoja Citas.');
    columns.forEach((column, index) => {
      // Las tres nuevas columnas son opcionales en los Excel de la versión 1.
      if (index >= 13 && !sheet.getRow(1).getCell(index + 1).value) return;
      if (sheet.getRow(1).getCell(index + 1).value !== column[1]) {
        throw new Error('Las columnas del Excel fueron modificadas.');
      }
    });
    const records = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const record = {};
      columns.forEach(([key], column) => { record[key] = String(row.getCell(column + 1).value ?? ''); });
      if (record.id) records.push(record);
    });
    const notifications = [];
    const notices = workbook.getWorksheet('Avisos');
    if (notices) {
      notificationColumns.forEach(([, label], index) => {
        if (notices.getRow(1).getCell(index + 1).value !== label) throw new Error('Las columnas de Avisos fueron modificadas.');
      });
      notices.eachRow((row, index) => {
        if (index === 1) return;
        const job = {};
        notificationColumns.forEach(([key], column) => { job[key] = String(row.getCell(column + 1).value ?? ''); });
        if (job.id) notifications.push(job);
      });
    }
    return { records, notifications };
  }

  async read() { return (await this.readState()).records; }

  async write(records, notifications = []) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Un plan contigo';
    const sheet = workbook.addWorksheet('Citas', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map(([key, header, width]) => ({ key, header, width }));
    sheet.addRows(records);
    sheet.autoFilter = { from: 'A1', to: `K${Math.max(records.length + 1, 1)}` };
    sheet.getRow(1).height = 28;
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFAA4D67' } };
      cell.alignment = { vertical: 'middle' };
    });
    sheet.getColumn('tokenHash').hidden = true;
    sheet.getColumn('requestId').hidden = true;
    sheet.getColumn('emailEvent').hidden = true;
    for (let index = 2; index <= sheet.rowCount; index++) {
      const row = sheet.getRow(index);
      row.height = 36;
      row.eachCell(cell => {
        cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF40323A' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3F4' } };
      });
    }
    const notices = workbook.addWorksheet('Avisos', { views: [{ state: 'frozen', ySplit: 1 }] });
    notices.columns = notificationColumns.map(([key, header, width]) => ({ key, header, width }));
    notices.addRows(notifications);
    notices.autoFilter = { from: 'A1', to: `K${Math.max(notifications.length + 1, 1)}` };
    notices.getColumn('snapshot').hidden = true;
    notices.getRow(1).height = 28;
    notices.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFAA4D67' } };
    });
    notices.eachRow((row, index) => {
      if (index === 1) return;
      row.height = 36;
      row.eachCell(cell => { cell.alignment = { vertical: 'middle', wrapText: true }; });
    });
    const temporary = join(this.directory, `citas-${randomUUID()}.tmp`);
    try {
      await workbook.xlsx.writeFile(temporary);
      try { await copyFile(this.path, `${this.path}.bak`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  list() { return this.run(() => this.read()); }
  state() { return this.run(() => this.readState()); }

  mutate(operation) {
    return this.run(async () => {
      const { records, notifications } = await this.readState();
      const result = await operation(records, notifications);
      await this.write(records, notifications);
      return result;
    });
  }

  snapshot() {
    return this.run(async () => {
      const { readFile } = await import('node:fs/promises');
      return readFile(this.path);
    });
  }
}
