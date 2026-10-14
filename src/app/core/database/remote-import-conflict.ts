/** A semantic collision requiring a user decision, distinct from I/O/auth failures. */
export class RemoteImportConflict extends Error {
  constructor() {
    super('Conflito ao receber dados. Suas compras locais foram preservadas.');
  }
}
