// Every /api/* request lands here: the existing zero-dependency backend,
// untouched. bodyParser off so the legacy handler reads the raw stream.
const handler = require('../../server.js');

export const config = { api: { bodyParser: false, externalResolver: true } };
export default handler;
