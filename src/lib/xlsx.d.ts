/** Types for xlsx.js, a minimal .xlsx writer copied from the BEMMP dashboard (src/data/xlsx.js there). */
export interface XlsxColumn { header: string; key: string; numeric?: boolean }
export interface XlsxSheet { name: string; columns: XlsxColumn[]; rows: object[] }
export function writeBook(sheets: XlsxSheet[]): Promise<Blob>
export function writeSheet(sheet: { sheetName?: string; columns: XlsxColumn[]; rows: object[] }): Promise<Blob>
export function saveBlob(blob: Blob, filename: string): void
