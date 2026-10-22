export interface PhotoTarget {
  barcode: string | null;
  itemId: string | null;
  name?: string;
}

export interface PreparedPhoto {
  imageBase64: string;
  contentType: 'image/jpeg';
  width: number;
  height: number;
}

export interface PhotoView {
  id: string;
  barcode: string | null;
  itemId: string | null;
  name: string;
  source: 'USER' | 'OPEN_FOOD_FACTS';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DELETED' | 'EXTERNAL';
  version: number;
  contentHash: string | null;
  sourceUrl: string | null;
  licenseUrl: string | null;
  updatedAt: string;
  own: boolean;
}

export interface StoredPhoto extends PhotoView {
  imageUrl: string;
}

export interface PhotoPreference {
  key: string;
  barcode: string | null;
  itemId: string | null;
  photoId: string | null;
  hidden: boolean;
  version: number;
}

export interface PhotoJob {
  sequence: number;
  id: string;
  kind: 'UPLOAD' | 'IMPORT' | 'PREFERENCE' | 'DELETE';
  target_key: string;
  payload_json: string;
  request_json: string | null;
  attempts: number;
  next_attempt_at_ms: number;
  status: 'PENDING' | 'FAILED';
}

export const photoByteLimit = 500 * 1024;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function photoKey(target: PhotoTarget): string {
  if (target.barcode !== null) {
    if (!/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13})$/.test(target.barcode))
      throw new Error('Informe um código de barras válido para a foto.');
    return 'barcode:' + target.barcode;
  }
  if (!target.itemId || !uuidPattern.test(target.itemId))
    throw new Error('Salve o item antes de adicionar uma foto.');
  return 'item:' + target.itemId;
}

export function validImageBase64(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(photoByteLimit / 3) * 4 ||
    /[^A-Za-z0-9+/=]/.test(value)
  )
    return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (
    !value.slice(0, value.length - padding).includes('=') &&
    value.length * 0.75 - padding <= photoByteLimit
  );
}

export function validatePhoto(value: unknown): PhotoView {
  if (!value || typeof value !== 'object') throw new Error('Invalid photo');
  const p = value as Record<string, unknown>;
  if (
    !uuidPattern.test(String(p['id'])) ||
    typeof p['name'] !== 'string' ||
    p['name'].length > 120 ||
    !['USER', 'OPEN_FOOD_FACTS'].includes(String(p['source'])) ||
    !['PENDING', 'APPROVED', 'REJECTED', 'DELETED', 'EXTERNAL'].includes(String(p['status'])) ||
    !Number.isSafeInteger(p['version']) ||
    Number(p['version']) < 0 ||
    typeof p['own'] !== 'boolean' ||
    (p['barcode'] !== null &&
      (typeof p['barcode'] !== 'string' ||
        !/^(?:[0-9]{8}|[0-9]{12}|[0-9]{13})$/.test(p['barcode']))) ||
    (p['itemId'] !== null && !uuidPattern.test(String(p['itemId']))) ||
    (!p['own'] && p['status'] !== 'APPROVED')
  )
    throw new Error('Invalid photo');
  const source = p['source'] as PhotoView['source'];
  return {
    id: String(p['id']),
    barcode: p['barcode'] as string | null,
    itemId: p['itemId'] as string | null,
    name: p['name'],
    source,
    status: p['status'] as PhotoView['status'],
    version: Number(p['version']),
    contentHash:
      typeof p['contentHash'] === 'string' && /^[a-f0-9]{64}$/.test(p['contentHash'])
        ? p['contentHash']
        : null,
    sourceUrl:
      source === 'OPEN_FOOD_FACTS' && p['barcode']
        ? 'https://world.openfoodfacts.org/product/' + p['barcode']
        : null,
    licenseUrl:
      source === 'OPEN_FOOD_FACTS' ? 'https://opendatacommons.org/licenses/odbl/1-0/' : null,
    updatedAt:
      typeof p['updatedAt'] === 'string' && Number.isFinite(Date.parse(p['updatedAt']))
        ? p['updatedAt']
        : '',
    own: p['own'],
  };
}

export function validatePreference(value: unknown): PhotoPreference {
  if (!value || typeof value !== 'object') throw new Error('Invalid preference');
  const p = value as PhotoPreference;
  if (
    p.key !== photoKey(p) ||
    typeof p.hidden !== 'boolean' ||
    !Number.isSafeInteger(p.version) ||
    p.version < 0 ||
    (p.photoId !== null && !uuidPattern.test(p.photoId))
  )
    throw new Error('Invalid preference');
  return {
    key: p.key,
    barcode: p.barcode,
    itemId: p.itemId,
    photoId: p.photoId,
    hidden: p.hidden,
    version: p.version,
  };
}
